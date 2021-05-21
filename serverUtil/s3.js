const {S3Client, PutObjectCommand, GetObjectCommand} = require("@aws-sdk/client-s3");
const {getSignedUrl} = require("@aws-sdk/s3-request-presigner");
const REGION = "us-east-2"; // Set the AWS Region. e.g. "us-east-1"


async function uploadImageToS3(name,file, uuid) {
	let imageParams = {
		Bucket: "mymojibucket",
		Key: uuid + "/"+ name+".png",
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

async function getImageUrlFromS3(uuid, name) {
	let imageParams = {
		Bucket: "mymojibucket",
		Key: "",
	}
	imageParams.Key = uuid + "/" + name + ".png";

	const s3 = new S3Client({region: REGION});

	try {
		// Create the command.
		const command = new GetObjectCommand(imageParams);

		console.log(`\nGetting "${imageParams.Key}" using signedUrl in v3`);
		// console.log(signedUrl);

		// Create the presigned URL.
		const signedUrl = await getSignedUrl(s3, command, {
			expiresIn: 3600,
		});
		console.log("Successfully got URL!");
		return ({"signed": signedUrl});
	} catch (err) {
		console.log("Error creating presigned URL", err);
	}
}

module.exports = {
	uploadImageToS3,
	getImageUrlFromS3,
}
// module.exports.uploadImageToS3 = uploadImageToS3;
// module.exports.getImageUrlFromS3 = getImageUrlFromS3;


