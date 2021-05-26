const {WebClient, LogLevel} = require("@slack/web-api");
const client = new WebClient(process.env.SLACK_OAUTH, {
	// LogLevel can be imported and used to make debugging simpler
	logLevel: LogLevel.DEBUG
});
// Post a message to a channel your app is in using ID and message text
async function publishSlackMessage(text) {
	try {
		// Call the chat.postMessage method using the built-in WebClient
		const result = await client.chat.postMessage({
			// The token you used to initialize your app
			token: process.env.SLACK_OAUTH,
			channel: process.env.SLACK_CHANNEL_ID,
			text: text
			// You could also use a blocks[] array to send richer content
		});
		// Print result, which includes information about the message (like TS)
		console.log(result);
	} catch (error) {
		console.error(error);
	}
}

function sendEmail(send_to,subject, text) {
	let nodemailer = require('nodemailer');
	let transporter = nodemailer.createTransport({
		service: 'gmail',
		auth: {
			user: process.env.EMAIL_USER,
			pass: process.env.EMAIL_PASS
		}
	});
	let mailOptions = {
		from: '',
		to: send_to,
		subject: subject,
		text: text,
	};
	transporter.sendMail(mailOptions, function (error, info) {
		if (error) {
			console.log(error);
		} else {
			console.log('Email sent: ' + info.response);
		}
	});
}

module.exports = {
	publishSlackMessage,
	sendEmail
}
