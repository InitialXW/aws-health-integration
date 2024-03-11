import { jsonToPlainText } from "json-to-plain-text";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { PutObjectCommand } from '@aws-sdk/client-s3';

const options = {
    color: false,                     // Whether to apply colors to the output or not
    spacing: true,                    // Whether to include spacing before colons or not
    seperator: ":",                   // seperate keys and values.
    squareBracketsForArray: false,    // Whether to use square brackets for arrays or not
    doubleQuotesForKeys: false,       // Whether to use double quotes for object keys or not
    doubleQuotesForValues: false,     // Whether to use double quotes for string values or not
}
const s3 = new S3Client();
const s3Target = new S3Client({region: process.env.TARGET_S3_REGION});

export const lambdaHandler = async (event, context) => {
    console.log("Incoming event: ", JSON.stringify(event, null, 2))
    for (const record of event.Records) {
        let eventBody = JSON.parse(record.body)
        let fileContent = await downloadFile(eventBody.detail.bucket.name, eventBody.detail.object.key);
        let plainText = ''
        try {
            plainText = jsonToPlainText(JSON.parse(fileContent), options);
        } catch (error) {
            plainText = jsonToPlainText(fileContent);
        }
        console.log("Plain text: ", plainText);
        return await uploadFile(process.env.TARGET_S3, `${eventBody.detail.object.key}.txt`, plainText)
    }
}

 /* function using AWS SDK v3 to download a file from aws s3 bucket with the given bucket name and file path */
const downloadFile = async (bucketName, filePath) => {
    const params = { Bucket: bucketName, Key: filePath };
    const data = await s3.send(new GetObjectCommand(params));
    const fileContent = data.Body.transformToString();
    return fileContent;
}

 /* function using AWS SDK v3 to take a string input and upload as a text file to aws s3 bucket with the given bucket name and file path */
const uploadFile = async (bucketName, filePath, fileContent) => {
    const params = { Bucket: bucketName, Key: filePath, Body: fileContent };
    return s3Target.send(new PutObjectCommand(params));
}