const express = require('express');
const app = express();
const {resolve} = require('path');
app.use(express.json());
const multer = require('multer');
const upload = multer();
const url = require('url');
const {S3Client, PutObjectCommand, GetObjectCommand} = require("@aws-sdk/client-s3");
const { getSignedUrl  } = require("@aws-sdk/s3-request-presigner");
const fs = require('fs');
const REGION = "us-east-2"; // Set the AWS Region. e.g. "us-east-1"
const { v4: uuidV4 } = require('uuid')



//development mode uses DOTENV to load a .env file which contains the environmental variables. Access via process.env
if (process.env.NODE_ENV === 'development') {
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

app.post('/create-checkout-session/:uuid', async (req, res) => {
	console.log("create checkout session called");
	const domainURL = process.env.DOMAIN;
	const pmTypes = (process.env.PAYMENT_METHOD_TYPES || 'card').split(',').map((m) => m.trim());
	const session = await stripe.checkout.sessions.create({
		payment_method_types: pmTypes,
		mode: 'payment',
		locale: req.body.locale,
		line_items: [
			{
				price: process.env.PRICE,
				quantity: 1
			},
		],
		// ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
		success_url: `${domainURL}/success.html?session_id={CHECKOUT_SESSION_ID}&uuid=`+req.params.uuid,
		cancel_url: `${domainURL}/newOrder.html`,
	});

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

app.get('/uuid', async (request, response)=>{
	response.send({uuid: uuidV4()})
})

app.post('/form-data', upload.single('upload'), async (req, res) => {
	console.log("req.file", req.file);
	console.log("req.body", req.body);
	let {name, email, uuid, sessionID} = req.body;
	console.log(name, email, uuid, sessionID);
	//upload user data to databse of some sort
	await uploadImageToS3(req.file, uuid);

});

app.get('/photo/:uuid/:type', async (req, res) => {
	console.log("uuid: ", req.params.uuid);
	console.log("uuid: ", req.params.type);
	const data = await getImageUrlFromS3(req.params.uuid, req.params.type);
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

async function getImageUrlFromS3(uuid, type){
	let imageParams = {
		Bucket: "mymojibucket",
		Key: "",
	}
	if (type === "INITIAL_UPLOAD"){
		imageParams.Key = uuid + "/initialUpload.png";
	}else if(type === "RENDITION"){
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
	}
	catch (err) {
		console.log("Error creating presigned URL", err);
	}
}

async function uploadImageToS3(file, uuid) {

	console.log("enter form upload");

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
		const data = await s3.send(new PutObjectCommand(imageParams));
		// console.log("Success", data);
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
