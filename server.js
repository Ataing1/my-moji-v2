const express = require('express');
const app = express();
app.use(express.json());
const multer = require('multer');
const upload = multer();
const {uploadImageToS3, getImageUrlFromS3} = require("./serverUtil/s3");
const {putItemInDatabase, updateItemInDatabase, getDynamoItem} = require("./serverUtil/dynamo");
const {v4: uuidV4} = require('uuid')
const devMode = process.env.NODE_ENV === 'development';
const INITIAL_UPLOAD = "initial-upload";
//USE GLOBAL VARIABLES SPARINGLY

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

app.set('view engine', 'ejs');
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

//EXAMPLE OF MIDDLEWARE as template for future middleware if needed. sets active property to head of path.
// app.use(function(req, res, next){
// 	req.active = req.path.split('/')[1] // [0] will be empty since routes start with '/'
// 	next();
// });

app.get('/', (req, res) => {
	res.render('pages/index', {active: ""});
});
app.get('/newOrder', (req, res) => {
	res.render('pages/newOrder');
});
app.get('/successfulOrder', (req, res) => {
	res.render('pages/successfulOrder');
});
app.get('/viewOrder/:uuid', async (req, res) => {
	// send name, intro line, mugshot link, rendition link or status no rendition yet
	//TODO redirect to download page if status is complete
	//http://expressjs.com/de/api.html#res.redirect

	const item = await getDynamoItem("abc123");
	let original = await getImageUrlFromS3(req.params.uuid, INITIAL_UPLOAD);
	let renditionURL = "";
	let introLine = "your MyMoji is now in progress.";
	if (item.rendition_status !== "pending-rendition") {
		const renditionObject = await getImageUrlFromS3(req.params.uuid, item.renditions[0].name);
		renditionURL = renditionObject.signed;
		introLine = "Your Mymoji is Ready!"
	}
	console.log("rendering", {
		item: item,
		introLine: introLine,
		originalURL: original.signed,
		renditionURL: renditionURL,
	})
	res.render("pages/viewOrder", {
		item: item,
		introLine: introLine,
		originalURL: original.signed,
		renditionURL: renditionURL,
	})
});

app.get('/artistView/:uuid', async (req, res) => {
	const item = await getDynamoItem("abc123");
	let original = await getImageUrlFromS3(req.params.uuid, INITIAL_UPLOAD);
	//load the last 5 renditions and current
	//the first feedback could be pending, so we do a check only for the latest rendition, all others should have a corresponding feedback

	//shape of renditions array:[{name: "rendition-1", feedback: "awaiting user feedback"}]
	let renditionArray = [];
	for(let i = 0;i<item.renditions.length;i++){
		const rendition = await getImageUrlFromS3(req.params.uuid, item.renditions[i].name);
		renditionArray[i] = {url: rendition.signed, feedback: item.renditions[i].feedback};
	}
	res.render("pages/artistView", {
		orderID: req.params.uuid,
		item: item,
		originalURL: original.signed,
		renditionArray: renditionArray,
	})
});

app.get('/downloadView/:uuid', async (req, res)=>{
	res.render("pages/download");
});

app.get('/feedbackView/:uuid', async (req, res)=>{
	//send latest rendition url to display
	const item = await getDynamoItem("abc123");
	const renditionObject = await getImageUrlFromS3(req.params.uuid, item.renditions[0].name);
	const renditionURL = renditionObject.signed;

	res.render("pages/feedback", {renditionURL: renditionURL});
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
		metadata: { //use  to match data with database
			name: req.body.name,
			email: req.body.email,
			uuid: req.body.uuid,
		},

		// ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
		success_url: `${domainURL}/successfulOrder?session_id={CHECKOUT_SESSION_ID}&uuid=` + uuid,
		cancel_url: `${domainURL}/newOrder`,
	});
	await uploadImageToS3(INITIAL_UPLOAD, req.file, uuid);
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
		renditions: [],

	}
	//renditions {"rendtion_0": "feedback"}
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
		//TODO #2 slack notify the artist


	}
	res.sendStatus(200);
});


/**
 * gets image url from s3 database
 * uuid/type.png
 * type - "INITAL_UPLOAD, RENDITION, ..."
 */
app.get('/photo/:uuid/:name', async (req, res) => {
	console.log("uuid: ", req.params.uuid);
	console.log("name: ", req.params.name);

	const data = await getImageUrlFromS3(req.params.uuid, req.params.name);
	res.send(data);
})




app.post('/rendition/:uuid', upload.single('upload'), async(req, res)=>{
	console.log("uploading new rendition");
	console.log("req.body", req.body);
	console.log("req.file", req.file);
	const {renditionCount} = req.body;
	const newRenditionObject = {
		name: "rendition_" + renditionCount,
		feedback: "null"
	}
	await uploadImageToS3(newRenditionObject.name, req.file, req.params.uuid);
	const data = await updateItemInDatabase(req.params.uuid, {rendition: newRenditionObject});
	res.send(data);

})

app.post('/feedback/:uuid', upload.none(), async (req, res)=>{
	console.log("uploading user feedback");
	console.log("req.body", req.body);
	const {feedback} = req.body;
	const data = await updateItemInDatabase(req.params.uuid, {feedback: feedback});
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

//LEAVE THIS AT THE END OF THE FILE -- OPENS THE PORT TO LISTEN TO INCOMING REQUESTS
let port = process.env.PORT || 4242;

if (port == 4242) {
	app.listen(port, () => console.log('running on http://localhost:' + port));
} else {
	app.listen(port, () => console.log('Live using port: ' + port));
}
/*
let newOrder = {
		customer_id: uuid,
		name: req.body.name,
		email: req.body.email,
		notes: req.body.notes,
		session_id: session.id,
		created_at: new Date(Date.now()).toString(),
		updated_at: new Date(Date.now()).toString(),
		status: "pending-rendition",
		renditions: {
			rendition_0: {
			},
			rendition_1: {
			},
			rendition_2:{
			},
		},

	}
 */
