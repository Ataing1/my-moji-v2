const express = require('express');
const app = express();
const {resolve} = require('path');
app.use(express.json());
const multer = require('multer');
const upload = multer();
const url = require('url');
const {S3Client, PutObjectCommand, GetObjectCommand} = require("@aws-sdk/client-s3");
const {
	DynamoDBClient,
	PutItemCommand,
	GetItemCommand,
	UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const {marshall, unmarshall} = require("@aws-sdk/util-dynamodb");
const {getSignedUrl} = require("@aws-sdk/s3-request-presigner");


const fs = require('fs');
const REGION = "us-east-2"; // Set the AWS Region. e.g. "us-east-1"
const {v4: uuidV4} = require('uuid')
const devMode = process.env.NODE_ENV === 'development';

//development mode uses DOTENV to load a .env file which contains the environmental variables. Access via process.env
if (devMode) {
	console.log("THIS IS DEVELOPMENT MODE");
	console.log(require('dotenv').config())
	require('dotenv').config({path: './.env'});
	const cors = require('cors');
	app.use(cors());
} else {
	console.log("THIS IS PRODUCTION MODE");
	console.log(process.env);
}

checkEnv(); //check if price environmental variable is set for STRIPE
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); //init stripe

app.use(express.static(process.env.STATIC_DIR));
app.use(express.json({
		// We need the raw body to verify webhook signatures.
		// Let's compute it only when hitting the Stripe webhook endpoint.
		verify: function (req, res, buf) {
			if (req.originalUrl.startsWith('/webhook')) {
				req.rawBody = buf.toString();
			}
		},
	})
);

app.get('/', (req, res) => {
	const path = resolve(process.env.STATIC_DIR + '/index.html');
	res.sendFile(path);
});

app.get('/public-keys', (req, res) => {
	res.send({key: process.env.STRIPE_PUBLISHABLE_KEY});
});

app.get('/config', async (req, res) => {
	const price = await stripe.prices.retrieve(process.env.PRICE);

	res.send({
		publicKey: process.env.STRIPE_PUBLISHABLE_KEY,
		unitAmount: price.unit_amount,
		currency: price.currency,
	});
});

// Fetch the Checkout Session to display the JSON result on the success page
app.get('/checkout-session', async (req, res) => {
	const {sessionId} = req.query;
	const session = await stripe.checkout.sessions.retrieve(sessionId);
	res.send(session);
});

app.post('/create-checkout-session', upload.single('upload'), async (req, res) => {
	console.log("create checkout session called");
	console.log("req.body", req.body);
	console.log("req.file", req.file);

	const uuid = devMode ? "abc123" : uuidV4(); //if devmode: hard coded value, else a unique ID
	const domainURL = process.env.DOMAIN;
	const pmTypes = (process.env.PAYMENT_METHOD_TYPES || 'card').split(',').map((m) => m.trim());
	const session = await stripe.checkout.sessions.create({
		client_reference_id: req.body.uuid,
		customer_email: req.body.email,
		payment_method_types: pmTypes,
		mode: 'payment',
		line_items: [
			{
				price: process.env.PRICE,
				quantity: 1
			},
		],
		metadata: {
			name: req.body.name,
			email: req.body.email,
			uuid: req.body.uuid,
		},

		// ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
		success_url: `${domainURL}/success.html?session_id={CHECKOUT_SESSION_ID}&uuid=` + uuid,
		cancel_url: `${domainURL}/newOrder.html`,
	});
	await uploadImageToS3(req.file, uuid);
	//add sessionID to database object and add object to database.
	//add date created with date.now
	let newOrder = {
		customer_id: uuid,
		name: req.body.name,
		email: req.body.email,
		notes: req.body.notes,
		session_id: session.id,
		created_at: new Date(Date.now()).toString(),
		updated_at: new Date(Date.now()).toString(),
		status: "pending-rendition",
		feedback: [],
		renditions: 0

	}
	await putItemInDatabase(newOrder);

	res.send({
		sessionId: session.id,
	});
});


// Webhook handler for asynchronous events.
app.post('/webhook', async (req, res) => {
	console.log("webhook called");
	let data;
	let eventType;
	// Check if webhook signing is configured.
	if (process.env.STRIPE_WEBHOOK_SECRET) {
		// Retrieve the event by verifying the signature using the raw body and secret.
		let event;
		let signature = req.headers['stripe-signature'];

		try {
			event = stripe.webhooks.constructEvent(
				req.rawBody,
				signature,
				process.env.STRIPE_WEBHOOK_SECRET
			);
		} catch (err) {
			console.log(`⚠️  Webhook signature verification failed.`);
			return res.sendStatus(400);
		}
		// Extract the object from the event.
		data = event.data;
		console.log(data);
		eventType = event.type;
	} else {
		// Webhook signing is recommended, but if the secret is not configured in `config.js`,
		// retrieve the event data directly from the request body.
		data = req.body.data;
		console.log(data);
		eventType = req.body.type;
	}
	if (eventType === 'checkout.session.completed') {
		console.log(`🔔  Payment received!`);
		sendEmail(data);
		//TODO #1 store data in database about the user
		//TODO #2 slack notify the artist


	}
	res.sendStatus(200);
});


/**
 * gets image url from s3 database
 * uuid/type.png
 * type - "INITAL UPLOAD, RENDITION, ..."
 */
app.get('/photo/:uuid/:type', async (req, res) => {
	console.log("uuid: ", req.params.uuid);
	console.log("uuid: ", req.params.type);
	const data = await getImageUrlFromS3(req.params.uuid, req.params.type);
	res.send(data);
})

app.post('/testing/:uuid',upload.none(), async (req, res) => {
	//loop through req.body, and set it to map
	console.log("testing called");
	// {renditions: 1, feedback: ["this is another one"]}
	const data = await updateItemInDatabase(req.params.uuid,req.body);
	res.send(data);
})


function sendEmail(event) {
	let nodemailer = require('nodemailer');

	let transporter = nodemailer.createTransport({
		service: 'gmail',
		auth: {
			user: 'ataing1883@gmail.com',
			pass: process.env.EMAIL_PASS
		}
	});

	let mailOptions = {
		from: 'ataing1883@gmail.com',
		to: 'ataing1883@gmail.com',
		subject: 'Sending Email using Node.js',
		text: 'THE WEB HOOK WORKS ISN"T THAT AMAZING! payment is successful' + event.toString()
	};

	transporter.sendMail(mailOptions, function (error, info) {
		if (error) {
			console.log(error);
		} else {
			console.log('Email sent: ' + info.response);
		}
	});
}

function checkEnv() {
	const price = process.env.PRICE;
	if (price === "price_12345" || !price) {
		console.log("You must set a Price ID in the environment variables. Please see the README.");
		process.exit(0);
	}
}

//let let contacts = new Map()
// contacts.set('Jessie', {phone: "213-555-1234", address: "123 N 1st Ave"})
// contacts.has('Jessie') // true
// contacts.get('Hilary') // undefined
// contacts.set('Hilary', {phone: "617-555-4321", address: "321 S 2nd St"})
// contacts.get('Jessie') // {phone: "213-555-1234", address: "123 N 1st Ave"}
// contacts.delete('Raymond') // false
// contacts.delete('Jessie') // true
// console.log(contacts.size) // 1
/**
 *
 * @param uuid customer_id
 * @param items map of keys that need updating
 * @returns {Promise<void>}
 */
async function updateItemInDatabase(uuid, items) {
	if (items.size === 0) return; //do nothing if map is empty
	let updateExpression = "SET ";
	let updateValues = {}
	// for (const [key, value] of items) {
	// 	console.log("key", key, "value", value);
	// 	switch (key) {
	// 		case "renditions":
	// 			updateExpression += "renditions = renditions + :renditions, ";
	// 			updateValues[":renditions"] = value;
	// 			break;
	// 		case "feedback":
	// 			updateExpression += "feedback = list_append(feedback, :feedback), ";
	// 			updateValues[":feedback"] = value;
	// 			break;
	// 	}
	// }
	console.log("items", items);
	const keys = Object.keys(items);
	for(let i = 0; i < keys.length; i++){
		//inserting new key value pair inside map
		// map.set(keys[i], obj[keys[i]]);
		switch (keys[i]) {
			case "renditions":
				updateExpression += "renditions = renditions + :renditions, ";
				updateValues[":renditions"] = 1;
				break;
			case "feedback":
				updateExpression += "feedback = list_append(feedback, :feedback), ";
				updateValues[":feedback"] = [items[keys[i]]]; //turns value in items[key[i]] into a list
				break;
		}
	};

	updateExpression += "updated_at = :update_time";
	updateValues[":update_time"] =	new Date(Date.now()).toString();

	console.log("update expression: ", updateExpression);
	console.log("update values: ", updateValues);
	//EXAMPLE OF PARAMS WHERE YOU INCREMENT RENDITIONS, APPEND A STRING TO A LIST, AND UPDATE A VALUE
	// const params = {
	// 	TableName: "orders",
	// 	Key: marshall({
	// 		customer_id: uuid
	// 	}),
	// 	UpdateExpression: "SET renditions = renditions + :renditions, feedback = list_append(feedback, :feedback), updated_at = :update_time",
	// 	ExpressionAttributeValues: marshall({
	// 		":renditions": 1,
	// 		":feedback": ["new feedback"],
	// 		":update_time": new Date(Date.now()).toString(),
	// 	})
	// };

	const params = {
		TableName: "orders",
		Key: marshall({
			customer_id: uuid
		}),
		UpdateExpression: updateExpression,
		ExpressionAttributeValues: marshall(updateValues)
	};

	const client = new DynamoDBClient({region: REGION});

	try {
		const data = await client.send(new UpdateItemCommand(params));
		console.log("Success - updated", data);
	} catch (err) {
		console.log("Error", err);
	}
}

async function putItemInDatabase(data) {
	// Set the parameters
	const params = {
		TableName: "orders",
		Item: marshall(data),
	};

// Create DynamoDB service object
	const dbclient = new DynamoDBClient({region: REGION});

	try {
		const data = await dbclient.send(new PutItemCommand(params));
		console.log("success");
		console.log(data);
	} catch (err) {
		console.error(err);
	}
}

async function getImageUrlFromS3(uuid, type) {
	let imageParams = {
		Bucket: "mymojibucket",
		Key: "",
	}
	if (type === "INITIAL_UPLOAD") {
		imageParams.Key = uuid + "/initialUpload.png";
	} else if (type === "RENDITION") {
		imageParams.Key = uuid + ""; //insert some other path to the rendition photo
	}

	const s3 = new S3Client({region: REGION});

	try {
		// Create the command.
		const command = new GetObjectCommand(imageParams);

		// Create the presigned URL.
		const signedUrl = await getSignedUrl(s3, command, {
			expiresIn: 3600,
		});
		console.log(`\nGetting "${imageParams.Key}" using signedUrl in v3`);
		console.log(signedUrl);

		return ({"signed": signedUrl, "potatoe": "i spelled that wrong"});
	} catch (err) {
		console.log("Error creating presigned URL", err);
	}
}

async function uploadImageToS3(file, uuid) {
	let imageParams = {
		Bucket: "mymojibucket",
		Key: uuid + "/initialUpload.png",
		ContentType: "image/png",
		// Body: file //DOES NOT WORK
		Body: file.buffer
		// Body: fs.createReadStream(body.file) //DOES NOT WORK
	};

	// Create an Amazon S3 service client object.
	const s3 = new S3Client({region: REGION});
	try {
		await s3.send(new PutObjectCommand(imageParams));
		console.log("Image uploaded Successfully");
	} catch (err) {
		console.log("Error", err);

	}

}


//LEAVE THIS AT THE END OF THE FILE -- OPENS THE PORT TO LISTEN TO INCOMING REQUESTS
let port = process.env.PORT || 4242;

if (port == 4242) {
	app.listen(port, () => console.log('running on http://localhost:' + port));
} else {
	app.listen(port, () => console.log('Live using port: ' + port));
}
