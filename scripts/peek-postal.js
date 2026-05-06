/**
 * Safe postal code data peeker
 * Reads only the first 3 entries to understand schema without blowing out token limit
 */

const fs = require('fs');
const readline = require('readline');

async function peekPostalCodes() {
  const filePath = './data/postal-codes.json';
  
  // Create a read stream
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let bracketCount = 0;
  let inArray = false;
  let entriesRead = 0;
  let output = '';

  for await (const line of rl) {
    // Track brackets to find array boundaries
    for (const char of line) {
      if (char === '[') {
        bracketCount++;
        if (bracketCount === 1) inArray = true;
      } else if (char === ']') {
        bracketCount--;
        if (bracketCount === 0) inArray = false;
      }
    }

    if (inArray) {
      output += line;
      
      // Count objects by tracking opening braces within the array
      const openBraces = (output.match(/{/g) || []).length;
      const closeBraces = (output.match(/}/g) || []).length;
      
      if (openBraces > 0 && openBraces === closeBraces) {
        entriesRead++;
        console.log(`\n=== ENTRY ${entriesRead} ===`);
        try {
          // Extract the last complete object
          const lastBrace = output.lastIndexOf('}');
          const lastOpenBrace = output.lastIndexOf('{', lastBrace);
          const objStr = output.substring(lastOpenBrace, lastBrace + 1);
          const obj = JSON.parse(objStr);
          console.log(JSON.stringify(obj, null, 2));
        } catch (e) {
          // Try to find complete object another way
        }
        output = '';
        
        if (entriesRead >= 3) {
          console.log('\n=== Stopping after 3 entries ===');
          break;
        }
      }
    }
  }

  rl.close();
  fileStream.close();
}

// Also peek at FSA centroids
function peekFSACentroids() {
  const data = require('./data/fsa-centroids.json');
  console.log('\n\n=== FSA CENTROIDS SAMPLE ===');
  console.log('Type:', Array.isArray(data) ? 'Array' : 'Object');
  console.log('Total entries:', Array.isArray(data) ? data.length : Object.keys(data).length);
  console.log('\nFirst 2 entries:');
  const entries = Array.isArray(data) ? data : Object.values(data);
  console.log(JSON.stringify(entries.slice(0, 2), null, 2));
}

peekPostalCodes().then(() => peekFSACentroids()).catch(console.error);