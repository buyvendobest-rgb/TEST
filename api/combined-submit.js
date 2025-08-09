// This file handles submissions for all marketplaces into a single Google Sheet.

const { google } = require('googleapis');

exports.handler = async (req, res) => {
    try {
        const body = req.body;
        
        if (!body) {
            console.error("Error: The request body is empty or malformed.");
            return res.status(400).json({ error: 'Bad Request: No data in request body.' });
        }
        
        // Define the simplified headers for the SINGLE combined spreadsheet
        // These MUST match the order and names you want in your Google Sheet columns.
        const defaultHeaders = [
            "Date",
            "Courier",
            "QTY",
            "Description",
            "Order ID",
            "Remarks", // Index 5
            "Marketplace" 
        ];
        
        // --- IMPORTANT: Replace with your SINGLE Master Spreadsheet ID ---
        const spreadsheetId = '1FDywzmTepdzw5WEjVlP8bG5ODlYBVJYDqRp2eMdf8sk'; // <--- Ensure this is your correct ID
        // This should be the SAME ID for both combined-submit.js and combined-get-data.js
        
        const today = new Date();
        const month = today.toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'long' });
        const year = today.getFullYear();
        const sheetName = `${month} ${year}`; // Sheet names will be "August 2025", etc.
        
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Full read/write scope
        });

        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        let currentSheetId;

        // Function to check if a row looks like a day header (e.g., "Thursday, August 8, 2025")
        const isDayHeaderRow = (rowContent) => {
            if (!rowContent || rowContent.length === 0 || typeof rowContent[0] !== 'string') {
                return false;
            }
            // Simple regex to check for a weekday, month, day, year pattern
            const dayHeaderPattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s[A-Za-z]+\s\d{1,2},\s\d{4}$/;
            return dayHeaderPattern.test(rowContent[0]);
        };

        // Function to compare two arrays for exact match
        const arraysMatch = (arr1, arr2) => {
            if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
            for (let i = 0; i < arr1.length; i++) {
                if (arr1[i] !== arr2[i]) return false;
            }
            return true;
        };

        try {
            const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
            const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
            const foundSheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
            currentSheetId = foundSheet ? foundSheet.properties.sheetId : null;

            const newDayHeaderFormatted = `${today.toLocaleString('en-US', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;

            let shouldInsertHeaders = false; // Flag to decide if we need to insert the blank row, day header, and default headers

            if (!currentSheetId) { // Sheet for the current month does not exist
                console.log(`Sheet "${sheetName}" not found. Creating a new one...`);
                const addSheetResponse = await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
                });
                currentSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
                shouldInsertHeaders = true; // Always insert headers for a brand new sheet

            } else { // Sheet exists, now perform robust checks
                // Fetch the last few rows to check for recent headers and day headers
                const lastRowsRange = `${sheetName}!A:A`; 
                const lastRowsResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: lastRowsRange });
                const allSheetRowsInColumnA = lastRowsResponse.data.values || [];

                // Fetch a small range that covers the default headers.
                const recentRowsFullRange = `${sheetName}!A${Math.max(1, allSheetRowsInColumnA.length - 10)}:G${allSheetRowsInColumnA.length}`; 
                const recentRowsFullResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: recentRowsFullRange });
                const recentFullRows = recentRowsFullResponse.data.values || [];

                let foundMatchingHeadersToday = false;
                
                for (let i = recentFullRows.length - 1; i >= 0; i--) {
                    const currentRow = recentFullRows[i];
                    if (arraysMatch(currentRow, defaultHeaders)) {
                        if (i > 0) {
                            const possibleDayHeaderRow = recentFullRows[i - 1];
                            if (isDayHeaderRow(possibleDayHeaderRow)) {
                                try {
                                    const dayHeaderDate = new Date(possibleDayHeaderRow[0]);
                                    if (dayHeaderDate.getDate() === today.getDate() &&
                                        dayHeaderDate.getMonth() === today.getMonth() &&
                                        dayHeaderDate.getFullYear() === today.getFullYear()) {
                                        foundMatchingHeadersToday = true;
                                        break; 
                                    }
                                } catch (e) {
                                    // Invalid date format, continue searching
                                }
                            }
                        }
                    }
                }
                
                if (!foundMatchingHeadersToday) {
                    shouldInsertHeaders = true;
                }
            }

            if (shouldInsertHeaders) {
                console.log(`Inserting/re-inserting headers for "${sheetName}".`);
                const headersToAppend = [[], [newDayHeaderFormatted], defaultHeaders]; 
                const appendResponse = await sheets.spreadsheets.values.append({
                    spreadsheetId,
                    range: `${sheetName}!A:A`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: headersToAppend },
                });

                const updatedRange = appendResponse.data.updates.updatedRange;
                const startRowIndexMatch = updatedRange.match(/!A(\d+):/);
                const startRowIndex = startRowIndexMatch ? parseInt(startRowIndexMatch[1], 10) - 1 : 0; 

                const requests = [
                    { // Format for blank row (optional)
                        repeatCell: {
                            range: { sheetId: currentSheetId, startRowIndex: startRowIndex, endRowIndex: startRowIndex + 1, startColumnIndex: 0, endColumnIndex: defaultHeaders.length },
                            cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 }, horizontalAlignment: 'CENTER' } },
                            fields: 'userEnteredFormat(backgroundColor,horizontalAlignment)'
                        }
                    },
                    { // Format for Day Header row (e.g., "Thursday, August 8, 2025")
                        repeatCell: {
                            range: { sheetId: currentSheetId, startRowIndex: startRowIndex + 1, endRowIndex: startRowIndex + 2, startColumnIndex: 0, endColumnIndex: defaultHeaders.length },
                            cell: { userEnteredFormat: { backgroundColor: { red: 0.7, green: 1.0, blue: 0.7 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER' } },
                            fields: 'userEnteredFormat(backgroundColor,textFormat.bold,horizontalAlignment)'
                        }
                    },
                    { // Format for actual column Headers (e.g., "Date", "Courier", "QTY"...)
                        repeatCell: {
                            range: { sheetId: currentSheetId, startRowIndex: startRowIndex + 2, endRowIndex: startRowIndex + 3, startColumnIndex: 0, endColumnIndex: defaultHeaders.length },
                            cell: { userEnteredFormat: { backgroundColor: { red: 0.7, green: 1.0, blue: 0.7 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER' } },
                            fields: 'userEnteredFormat(backgroundColor,textFormat.bold,horizontalAlignment)'
                        }
                    }
                ];
                await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
            }
        } catch (error) {
            console.error('Error during sheet setup or header validation:', error);
            return res.status(500).json({ message: 'Error during sheet setup or header validation.' });
        }

        // Map the incoming 'body' data to the 'defaultHeaders' order
        const newRow = defaultHeaders.map(header => {
            if (header.toLowerCase() === 'date') {
                const options = {
                    timeZone: 'Asia/Manila',
                    year: 'numeric', month: 'numeric', day: 'numeric',
                    hour: 'numeric', minute: 'numeric', second: 'numeric',
                    hour12: true
                };
                return today.toLocaleString('en-US', options);
            }
            if (header.toLowerCase() === 'marketplace') {
                return body.marketplace.toUpperCase(); 
            }
            const key = header.toLowerCase().replace(/\s/g, '-').replace(/'/g, '');
            return body[key] || ''; 
        });

        // Append the new row to the sheet and get its range
        const appendResult = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:A`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [newRow] },
        });

        // Apply centering to the newly appended row
        const updatedRange = appendResult.data.updates.updatedRange;
        const appendedRowIndexMatch = updatedRange.match(/!A(\d+):/);
        
        let remarksFormatRequest = null; // New variable for remarks formatting
        if (appendedRowIndexMatch && appendedRowIndexMatch[1]) {
            const appendedRowIndex = parseInt(appendedRowIndexMatch[1], 10) - 1; // Convert to 0-indexed
            const remarksColumnIndex = defaultHeaders.indexOf("Remarks"); // Get the column index for "Remarks"

            const centeringRequest = {
                repeatCell: {
                    range: {
                        sheetId: currentSheetId,
                        startRowIndex: appendedRowIndex,
                        endRowIndex: appendedRowIndex + 1,
                        startColumnIndex: 0,
                        endColumnIndex: defaultHeaders.length,
                    },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: 'CENTER',
                        }
                    },
                    fields: 'userEnteredFormat.horizontalAlignment'
                }
            };
            await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [centeringRequest] } });

            // --- NEW: Conditional highlighting for Remarks ---
            const remarksValue = newRow[remarksColumnIndex] ? newRow[remarksColumnIndex].toUpperCase() : '';
            let backgroundColor = null;

            if (remarksValue.includes('SUCCESS')) {
                backgroundColor = { red: 0.8, green: 1.0, blue: 0.8 }; // Light green
            } else if (remarksValue.includes('FAILED')) {
                backgroundColor = { red: 1.0, green: 0.7, blue: 0.7 }; // Light red
            }

            if (backgroundColor) {
                remarksFormatRequest = {
                    repeatCell: {
                        range: {
                            sheetId: currentSheetId,
                            startRowIndex: appendedRowIndex,
                            endRowIndex: appendedRowIndex + 1,
                            startColumnIndex: remarksColumnIndex,
                            endColumnIndex: remarksColumnIndex + 1, // Only the Remarks column
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: backgroundColor,
                            }
                        },
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                };
                await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [remarksFormatRequest] } });
            }
            // --- END NEW: Conditional highlighting for Remarks ---
        }

        return res.status(200).json({ message: 'Data submitted successfully to combined sheet!' });

    } catch (error) {
        console.error('Error submitting data to combined sheet:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
