const express = require('express');
const app = express();
const {resolve} = require('path');
app.use(express.json());
const multer = require('multer');
const upload = multer();
const {uploadImageToS3, getImageUrlFromS3} = require("./serverUtil/s3");
const {putItemInDatabase, updateItemInDatabase} = require("./serverUtil/dynamo");
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
	res.render('pages/index', {active: ""} );
});

app.get('/newOrder', (req, res) => {
	res.render('pages/newOrder' );
});

app.get('/successfulOrder', (req, res) => {
	res.render('pages/successfulOrder'  );
});

app.get('/success', (req, res) => {
	res.render('pages/viewOrder'  );
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
		success_url: `${domainURL}/successfulOrder?session_id={CHECKOUT_SESSION_ID}&uuid=` + uuid,
		cancel_url: `${domainURL}/newOrder`,
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

//LEAVE THIS AT THE END OF THE FILE -- OPENS THE PORT TO LISTEN TO INCOMING REQUESTS
let port = process.env.PORT || 4242;

if (port == 4242) {
	app.listen(port, () => console.log('running on http://localhost:' + port));
} else {
	app.listen(port, () => console.log('Live using port: ' + port));
}
