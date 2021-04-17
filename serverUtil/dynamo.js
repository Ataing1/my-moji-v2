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
 * @param items map of keys that need updating
 * @returns {Promise<void>}
 */
let updateItemInDatabase = async function updateItemInDatabase(uuid, items) {
	if (items.size === 0) return; //do nothing if map is empty
	let updateExpression = "SET ";
	let updateValues = {}
	console.log("items", items);
	const keys = Object.keys(items);
	for (let i = 0; i < keys.length; i++) {
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
	}

	updateExpression += "updated_at = :update_time";
	updateValues[":update_time"] = new Date(Date.now()).toString();

	console.log("update expression: ", updateExpression);
	console.log("update values: ", updateValues);
	//EXAMPLE OF PARAMS WHERE YOU INCREMENT RENDITIONS, APPEND A STRING TO A LIST, AND UPDATE A VALUE
	// 	UpdateExpression: "SET renditions = renditions + :renditions, feedback = list_append(feedback, :feedback), updated_at = :update_time",
	// 	ExpressionAttributeValues: marshall({":renditions": 1,":feedback": ["new feedback"],":update_time": new Date(Date.now()).toString(),})

	const params = {
		TableName: TABLE_NAME,
		Key: marshall({
			customer_id: uuid
		}),
		UpdateExpression: updateExpression,
		ExpressionAttributeValues: marshall(updateValues)
	};
	const client = new DynamoDBClient({region: REGION});
	try {
		const data = await client.send(new UpdateItemCommand(params));
		console.log("Success - updated item in database", data);
	} catch (err) {
		console.log("Error", err);
	}
}

let putItemInDatabase = async function putItemInDatabase(data) {
	// Set the parameters
	const params = {
		TableName: TABLE_NAME,
		Item: marshall(data),
	};
	const client = new DynamoDBClient({region: REGION});
	try {
		const result = await client.send(new PutItemCommand(params));
		console.log("success: put item in database", result);
	} catch (err) {
		console.error(err);
	}
}

let getDynamoItem = async function getDynamoItem(uuid) {

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
		unmarshall(Item);
		// Print the JavaScript object to console
		console.log("success: got item from database", Item);
		return Item;
	} catch (err) {
		console.log("Error", err);
	}

}

module.exports.updateItemInDatabase = updateItemInDatabase;
module.exports.putItemInDatabase = putItemInDatabase;
module.exports.getDynamoItem = getDynamoItem;
