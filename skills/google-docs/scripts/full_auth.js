const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');

// Reuse credentials from google-tasks to save setup time
const CREDENTIALS_PATH = path.join(__dirname, '../../google-tasks/credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function main() {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  const oAuth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    'http://localhost' 
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
    prompt: 'consent'
  });

  console.log('AUTHORIZE FULL DRIVE ACCESS:', authUrl);
  console.log('Send the code back like this: --code=YOUR_CODE');
}

main().catch(console.error);
