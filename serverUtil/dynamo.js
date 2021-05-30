const {
	DynamoDBClient,
	PutItemCommand,
	GetItemCommand,
	UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const {marshall, unmarshall} = require("@aws-sdk/util-dynamodb");
const REGION = "us-east-2"; // Set the AWS Region. e.g. "us-east-1"
const TABLE_NAME = "orders";

/**
 *
 * @param uuid customer_id
 * @param file_name value of key "name" in new rendition object
 * @returns {Promise<void>}
 */
async function AddRenditionToDatabase(uuid, file_name) {

	console.log(typeof (uuid), uuid, file_name);
	let updateExpression = "SET ";
	let updateValues = {};
	let newRendition = {
		name: file_name,
		feedback: "null"
	}
	updateExpression += "renditions = list_append(:rendition, if_not_exists(renditions, :empty_list)), "; //append to the front of list
	updateValues[":rendition"] = [newRendition]; //turns value in items[key[i]] into a list
	updateValues[":empty_list"] = []
	updateExpression += "rendition_status = :status, ";
	updateValues[":status"] = "pending-feedback"
	updateExpression += "updated_at = :updated_at";
	updateValues[":updated_at"] = {"S": new Date(Date.now()).toString()};

	//TODO unify status for update feedback and update rendition
	const params = {
		TableName: TABLE_NAME,
		Key: {
			customer_id: {"S": uuid}
		},
		UpdateExpression: updateExpression,
		ExpressionAttributeValues: marshall(updateValues),

	};
	const client = new DynamoDBClient({region: REGION});
	try {
		const data = await client.send(new UpdateItemCommand(params));
		// console.log("Success - updated item in database", data);
		console.log("Success - updated item in database");
	} catch (err) {
		console.log("Error", err);
	}

}

async function AddFeedbackToDatabase(uuid, feedback, index) {
	// testUpdate();
	// return;
	console.log(typeof (feedback), typeof (uuid), uuid, feedback);
	let updateExpression = "SET ";
	let updateValues = {};
	let attributeNames = {};
	updateExpression += `#renditions[${index}].feedback = :feedback`;
	updateValues[":feedback"] = {"S": feedback}; //turns value in items[key[i]]
	attributeNames["#renditions"] = "renditions";
	updateExpression += ", ";
	updateExpression += "rendition_status = :status";
	updateValues[":status"] = {"S": "pending-first-rendition"}; //turns value in items[key[i]]
	updateExpression += ", ";
	updateExpression += "#updated_at = :updated_at";
	updateValues[":updated_at"] = {"S": new Date(Date.now()).toString()}; //turns value in items[key[i]]
	attributeNames["#updated_at"] = "updated_at";

	const params = {
		TableName: TABLE_NAME,
		Key: {
			customer_id: {"S": uuid}
		},
		UpdateExpression: updateExpression,
		ExpressionAttributeValues: updateValues,
		ExpressionAttributeNames: attributeNames,

	};
	const client = new DynamoDBClient({region: REGION});
	try {
		const data = await client.send(new UpdateItemCommand(params));
		// console.log("Success - updated item in database", data);
		console.log("Success - updated item in database");
	} catch (err) {
		console.log("Error", err);
	}
}

async function clearFeedbackInDatabase(uuid,  indexesToDelete) {
	// testUpdate();
	// return;
	console.log(typeof (indexesToDelete), typeof (uuid), uuid, indexesToDelete);
	let updateExpression = "SET ";
	let updateValues = {};
	let attributeNames = {};
	for(let i = 0;i<indexesToDelete.length;i++){
		updateExpression += `#renditions[${indexesToDelete[i]}].feedback = :feedback`;
	}
	updateValues[":feedback"] = {"S": "N/A: Customer uploaded new mugshot"}; //turns value in items[key[i]]
	attributeNames["#renditions"] = "renditions";
	updateExpression += ", ";
	updateExpression += "rendition_status = :status";
	updateValues[":status"] = {"S": "pending-rendition"}; //turns value in items[key[i]]
	updateExpression += ", ";
	updateExpression += "#updated_at = :updated_at";
	updateValues[":updated_at"] = {"S": new Date(Date.now()).toString()}; //turns value in items[key[i]]
	attributeNames["#updated_at"] = "updated_at";

	console.log("update expression: ", updateExpression)
	const params = {
		TableName: TABLE_NAME,
		Key: {
			customer_id: {"S": uuid}
		},
		UpdateExpression: updateExpression,
		ExpressionAttributeValues: updateValues,
		ExpressionAttributeNames: attributeNames,

	};
	const client = new DynamoDBClient({region: REGION});
	try {
		const data = await client.send(new UpdateItemCommand(params));
		// console.log("Success - updated item in database", data);
		console.log("Success - updated items in database");
	} catch (err) {
		console.log("Error", err);
	}
}

async function putItemInDatabase(data) {
	// Set the parameters
	const params = {
		TableName: TABLE_NAME,
		Item: marshall(data),
	};
	const client = new DynamoDBClient({region: REGION});
	try {
		const result = await client.send(new PutItemCommand(params));
		// console.log("success: put item in database", result);
		console.log("success: put item in database");
	} catch (err) {
		console.error(err);
	}
}

async function getDynamoItem(uuid) {
	console.log("get item", uuid);
	const params = {
		TableName: TABLE_NAME,
		Key: marshall({
			customer_id: uuid
		}),
	};
	const client = new DynamoDBClient({region: REGION});
	try {
		const {Item} = await client.send(new GetItemCommand(params));
		// Convert the DynamoDB record you retrieved into a JavaScript object
		// console.log("pre unmarshal", Item);
		// Print the JavaScript object to console
		// console.log("success: got item from database", unmarshalledObject);
		return unmarshall(Item);
	} catch (err) {
		console.log("Error", err);
	}

}

module.exports = {
	getDynamoItem,
	putItemInDatabase,
	AddRenditionToDatabase,
	AddFeedbackToDatabase,
	clearFeedbackInDatabase
}
// module.exports.AddRenditionToDatabase = AddRenditionToDatabase;
// module.exports.AddFeedbackToDatabase = AddFeedbackToDatabase;
// module.exports.putItemInpDatabase = putItemInDatabase;
// module.exports.getDynamoItem = getDynamoItem;
