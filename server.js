const express = require('express');
const app = express();
app.use(express.json());
const multer = require('multer');
const upload = multer();
const {uploadImageToS3, getImageUrlFromS3} = require("./serverUtil/s3");
const {
	putItemInDatabase,
	AddRenditionToDatabase,
	AddFeedbackToDatabase,
	getDynamoItem,
	clearFeedbackInDatabase
} = require("./serverUtil/dynamo");
const {sendEmail, publishSlackMessage} = require("./serverUtil/messaging");
const short = require('short-uuid');
const humanId = require('human-readable-ids').hri;


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

/*	===========
	|| Utilities
 	===========
 */
// Fetch the Checkout Session to display the JSON result on the success page
app.get('/checkout-session', async (req, res) => {
	const {sessionId} = req.query;
	const session = await stripe.checkout.sessions.retrieve(sessionId);
	res.send(session);
});

app.get('/config', async (req, res) => {
	const price = await stripe.prices.retrieve(process.env.PRICE);
	res.send({
		publicKey: process.env.STRIPE_PUBLISHABLE_KEY,
		unitAmount: price.unit_amount,
		currency: price.currency,
	});
});
//EXAMPLE OF MIDDLEWARE as template for future middleware if needed. sets active property to head of path.
// app.use(function(req, res, next){
// 	req.active = req.path.split('/')[1] // [0] will be empty since routes start with '/'
// 	next();
// });

/*	===========
	|| Page Routes STATIC
 	===========
 */
app.get('/', (req, res) => {
	res.render('pages/index', {active: ""});
});
app.get('/aboutView', async (req, res) => {
	res.render("pages/aboutView");
})
app.get('/newOrder', (req, res) => {
	res.render('pages/newOrder');
});
app.get('/successfulOrder/:uuid', (req, res) => {
	res.render('pages/successfulOrder', {uuid: req.params.uuid});
});
app.get('/contactView', async (req, res) => {
	res.render("pages/contactView");
});
app.get('/privacyView', async (req, res) => {
	res.render("pages/privacyView");
});
app.get('/termsView', async (req, res) => {
	res.render("pages/termsView");
});
app.get('/successfulFeedback/:uuid', async (req, res) => {
	res.render("pages/successfulFeedback", {uuid: req.params.uuid});
});

/*	===========
	|| Page Routes DYNAMIC
 	===========
 */
app.get('/viewOrder/:uuid', async (req, res) => {
	// send name, intro line, mugshot link, rendition link or status no rendition yet
	try {
		const item = await getDynamoItem(req.params.uuid);
		//IF UUID IS NOT IN OUR DATABASE SEND A 404 error, or an oops this page does not exist
		if (item.rendition_status === "pending-first-rendition") {
			res.render("pages/notReadyView");
			return;
		}
		if (item.rendition_status === "pending-rendition") { //forward to pending screen to save image loads, and prevent user from inputting new feedback accidentally
			res.redirect("/successfulFeedback/" + req.params.uuid);
			return;
		}
		let original = await getImageUrlFromS3(req.params.uuid, INITIAL_UPLOAD);
		let renditionArray = [];
		for (let i = 0; i < item.renditions.length; i++) {
			if (item.renditions[i].feedback === "null") { //only show renditions without feedback, different than artist view, which shows every rendition
				const rendition = await getImageUrlFromS3(req.params.uuid, item.renditions[i].name);
				renditionArray[i] = {url: rendition.signed, feedback: item.renditions[i].feedback, rendition_number: i};
			}
		}
		res.render("pages/viewOrder", {
			item: item,
			originalURL: original.signed,
			renditionArray: renditionArray,
		});
	} catch (error) {
		console.error(error);
		res.render('pages/404')
	}
});

app.get('/artistView/:uuid', async (req, res) => {
	try{
		const item = await getDynamoItem(req.params.uuid);
		let original = await getImageUrlFromS3(req.params.uuid, INITIAL_UPLOAD);
		let renditionArray = [];
		for (let i = 0; i < item.renditions.length; i++) {
			const rendition = await getImageUrlFromS3(req.params.uuid, item.renditions[i].name);
			//replaces null feedback with pending feedback because we don't want to show the user "null"
			const feedbackValue = item.renditions[i].feedback === "null" ? "Pending feeedback" : item.renditions[i].feedback;
			renditionArray[i] = {url: rendition.signed, feedback: feedbackValue};
		}
		res.render("pages/artistView", {
			item: item,
			originalURL: original.signed,
			renditionArray: renditionArray,
		});
	}catch(error){
		console.error(error);
		res.render('pages/404');
	}
});

app.get('/downloadView/:uuid/:renditionNumber', async (req, res) => {
	try{
		const item = await getDynamoItem(req.params.uuid);
		const rendition = await getImageUrlFromS3(req.params.uuid, item.renditions[req.params.renditionNumber].name);
		const renditionUrl = rendition.signed;
		res.render("pages/download", {downloadUrl: renditionUrl});
	}catch (e) {
		console.error(e);
		res.render('pages/404');
	}
});

app.get('/feedbackView/:uuid/:renditionNumber', async (req, res) => {
	try{
		const item = await getDynamoItem(req.params.uuid);
		const renditionObject = await getImageUrlFromS3(req.params.uuid, item.renditions[req.params.renditionNumber].name);
		const renditionURL = renditionObject.signed;
		res.render("pages/feedback", {
			renditionURL: renditionURL,
			uuid: item.customer_id,
			renditionNumber: req.params.renditionNumber
		});
	}catch (e) {
		console.error(e);
		res.render('pages/404');
	}
});

app.get('/newCloseUp/:uuid', async (req, res) => {
	try{
		const item = await getDynamoItem(req.params.uuid);
		const originalObject = await getImageUrlFromS3(req.params.uuid, INITIAL_UPLOAD);
		const originalUrl = originalObject.signed;
		res.render("pages/newMugshotView", {originalUrl: originalUrl, uuid: item.customer_id});
	}catch (e) {
		console.error(e);
		res.render('pages/404');
	}
})

/*	===========
	|| POST Actions
 	===========
 */
/**
 * Action for when user submits new order form.
 * 1. creates UUID
 * 2. creates session
 * 3. uploads image to s3
 * 4. creates Customer Order
 * 5. uploads Customer Order to DynamoDB
 * 6. Sends Session ID response body
 */
app.post('/create-checkout-session', upload.single('upload'), async (req, res) => {
	const uuid = short.generate();
	const domainURL = process.env.DOMAIN;
	const pmTypes = (process.env.PAYMENT_METHOD_TYPES || 'card').split(',').map((m) => m.trim());
	const session = await stripe.checkout.sessions.create({
		client_reference_id: uuid,
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
			uuid: uuid,
		},
		allow_promotion_codes: true,
		// ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
		// success_url: `${domainURL}/successfulOrder?session_id={CHECKOUT_SESSION_ID}&uuid=` + uuid,
		success_url: `${domainURL}/successfulOrder/` + uuid,
		cancel_url: `${domainURL}/newOrder`,
	});
	// console.log("session object look like this: ", session)
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
		rendition_status: "pending-first-rendition",
		renditions: [],
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
		console.log("data from webhook", data);
		const metadata = data.object.metadata;
		const {name, email, uuid} = metadata;
		const domainURL = process.env.DOMAIN;
		const artistPageLink = `<${domainURL}/artistView/${uuid}|Artist page>`;
		const customerPageLink = `<${domainURL}/viewOrder/${uuid}|Customer page>`;
		const text = `We have a new order from ${name}\n\n\t${email}\n\n\t${artistPageLink}\n\n\t${customerPageLink}`
		await publishSlackMessage(text);
		const emailText = `Dear ${name},\n\nThank you for your order! Our artists will get to work right away. ` +
			`We'll email you when your MyMoji is ready (expect to hear back from us within 24-48 hours).\n\nOrder Id: ${uuid}\n` +
			"If you have any questions, please email us at support@mymoji.co\n\nThank you,\n\nThe MyMoji Team";
		sendEmail(email, "Thank you for your order!", emailText);
	}
	res.sendStatus(200);
});


/**
 * Action for when artist uploads rendition
 */
app.post('/rendition/:uuid', upload.single('upload'), async (req, res) => {
	console.log("uploading new rendition");
	console.log("req.body", req.body);
	console.log("req.file", req.file);
	const item = await getDynamoItem(req.params.uuid);
	const {name, email, customer_id} = item;
	let filename = "rendition_" + item.renditions.length;
	await uploadImageToS3(filename, req.file, req.params.uuid);
	await AddRenditionToDatabase(req.params.uuid, filename);
	const link = `${process.env.DOMAIN}/viewOrder/${customer_id}`
	const emailText = `Hi ${name},\n\nOur artists have finished your MyMoji. We can't wait to hear what you think.\n\nYou can check out your MyMoji at ${link}.`
	sendEmail(email, "Your MyMoji is ready", emailText);
	res.sendStatus(200);
});

/**
 * Action for when the user uploads feedback
 */
app.post('/feedback/:uuid/:renditionNumber', upload.none(), async (req, res) => {
	console.log("uploading user feedback");
	console.log("req.body", req.body);
	console.log("req id", req.params.uuid);
	const {feedback} = req.body;
	const processedFeedback = feedback.replace(/(\r\n|\n|\r)/gm, " ")
	console.log("feedback", processedFeedback, typeof (processedFeedback));
	await AddFeedbackToDatabase(req.params.uuid, feedback, req.params.renditionNumber);
	const item = await getDynamoItem(req.params.uuid);
	console.log("item received", item);
	const {name, email, customer_id} = item
	const domainURL = process.env.DOMAIN;
	const artistPageLink = `<${domainURL}/artistView/${customer_id}|Artist page>`;
	const customerPageLink = `<${domainURL}/viewOrder/${customer_id}|Customer page>`;
	const text = `${name} gave feedback: ${feedback}\n\n\t${email}\n\n\t${artistPageLink}\n\n\t${customerPageLink}`
	await publishSlackMessage(text);
	res.sendStatus(200);
})

/**
 * Action for when the user contacts MyMoji
 */
app.post('/contact', upload.none, async (req, res) => {
	console.log("contact api called");
	const {text} = req.body;
	sendEmail("support@mymoji.co", "A user has contacted MyMoji", text);
	res.sendStatus(200);
});

/**
 * Action for when user uploads a new Mugshot
 */
app.post('/newMugshot/:uuid', upload.single('upload'), async (req, res) => {
	let needsUpdate = [];
	const item = await getDynamoItem(req.params.uuid);
	for (let i = 0; i < item.renditions.length; i++) {
		if (item.renditions[i].feedback === "null") {
			needsUpdate.push(i);
		}
	}
	if (needsUpdate.length !== 0) {
		await clearFeedbackInDatabase(req.params.uuid, needsUpdate);
	}
	await uploadImageToS3(INITIAL_UPLOAD, req.file, req.params.uuid);
	const {name, email, customer_id} = item
	const domainURL = process.env.DOMAIN;
	const artistPageLink = `<${domainURL}/artistView/${customer_id}|Artist page>`;
	const customerPageLink = `<${domainURL}/viewOrder/${customer_id}|Customer page>`;
	const text = `${name} uploaded a new Mugshot:\n\n\t${email}\n\n\t${artistPageLink}\n\n\t${customerPageLink}`;
	await publishSlackMessage(text);
	res.sendStatus(200);
});

app.get('/downloadImage', (req, res) => {
	res.download("")
})


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
