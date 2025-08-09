// This file fetches all data from the single combined Google Sheet (simplified headers).

const { google } = require('googleapis');

exports.handler = async (req, res) => {
    try {
        // --- IMPORTANT: Replace with your SINGLE Master Spreadsheet ID ---
        const spreadsheetId = '1FDywzmTepdzw5WEjVlP8bG5ODlYBVJYDqRp2eMdf8sk'; // <--- CHANGE THIS
        // This should be the SAME ID as used in combined-submit.js

        const today = new Date();
        const month = today.toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'long' });
        const year = today.getFullYear();
        const sheetName = `${month} ${year}`;
        
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'], // Read-only scope is sufficient for getting data
        });

        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        // Get all data from the current month's sheet, starting from row 2 (after headers)
        // Range A to G to cover all 7 columns (0-indexed) based on new simplified headers
        const range = `${sheetName}!A2:G`; 
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });
        
        // If no data is found, 'values' might be undefined, so default to an empty array
        const rows = response.data.values || [];
        
        return res.status(200).json({ data: rows }); 

    } catch (error) {
        console.error('Error fetching data from combined sheet:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
