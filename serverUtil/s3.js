const {S3Client, PutObjectCommand, GetObjectCommand} = require("@aws-sdk/client-s3");
const {getSignedUrl} = require("@aws-sdk/s3-request-presigner");
const REGION = "us-east-2"; // Set the AWS Region. e.g. "us-east-1"


let uploadImageToS3 = async function uploadImageToS3(file, uuid) {
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

let getImageUrlFromS3 = async function getImageUrlFromS3(uuid, type) {
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


module.exports.uploadImageToS3 = uploadImageToS3;
module.exports.getImageUrlFromS3 = getImageUrlFromS3;


