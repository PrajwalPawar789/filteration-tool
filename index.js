const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs'); // Set EJS as the view engine

// PostgreSQL Pool setup
const pool = new Pool({
  user: 'prajwal.pawar',
  host: '192.168.1.39',
  database: 'LeadDB',
  password: 'PPIndia@098',
  port: 5432,
});

// Set up multer for file upload
const upload = multer({ dest: 'uploads/' });

// Function to read filters from Excel
const readFiltersFromExcel = (filePath) => {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = xlsx.utils.sheet_to_json(worksheet);

  console.log('Excel Data:', jsonData); // Debugging line

  return jsonData; // Returning all rows for processing multiple filters
};

// Function to export data to Excel
const exportToExcel = (data) => {
  const ws = xlsx.utils.json_to_sheet(data);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Data');
  const filePath = path.join(__dirname, 'temp_exported_data.xlsx');
  xlsx.writeFile(wb, filePath);

  return filePath;
};

// Route to render upload form
app.get('/', (req, res) => {
  res.render('upload');
});

// Filtering route
app.post('/filter', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const filters = readFiltersFromExcel(filePath);

  const filterConditions = {
    job_title: [],
    Company_Name: [],
    domain: [],
    Industry_Type: [],
    Revenue_Size: [],
    job_function: [],
    job_level: [],
    country: [],
    state: [],
    Sub_Industry: [],
    Employee_Size: []
  };

  // Aggregating filters
  filters.forEach(filter => {
    for (let key in filterConditions) {
      if (filter[key] && filter[key] !== '-') {
        filterConditions[key].push(filter[key]);
      }
    }
  });

  console.log('Aggregated Filter Conditions:', filterConditions); // Debugging line

  // Initialize the query variables
  let queryCountRows = 'SELECT COUNT(*) AS total_contacts FROM public."Inhouse2" WHERE 1=1';
  let queryCountUniqueCompanies = 'SELECT COUNT(DISTINCT "Company_Name") AS unique_companies FROM public."Inhouse2" WHERE 1=1';
  let queryCountryWiseContacts = 'SELECT country, COUNT(*) AS total_contacts FROM public."Inhouse2" WHERE 1=1';
  let queryCountryWiseUniqueCompanies = 'SELECT country, COUNT(DISTINCT "Company_Name") AS unique_companies FROM public."Inhouse2" WHERE 1=1';
  
  // New query to select all rows
  let querySelectAll = 'SELECT * FROM public."Inhouse2" WHERE 1=1';

  const params = [];
  let paramIndex = 1;

  const addConditions = (key, field, useSimilarTo = false) => {
    if (filterConditions[key] && filterConditions[key].length > 0) {
      const conditions = filterConditions[key].map(() => {
        if (useSimilarTo) {
          // SIMILAR TO pattern syntax requires % for wildcard matching
          return `${field} SIMILAR TO $${paramIndex++}`;
        } else {
          return `${field} = $${paramIndex++}`;
        }
      }).join(' OR ');
  
      if (conditions) {
        queryCountRows += ` AND (${conditions})`;
        queryCountUniqueCompanies += ` AND (${conditions})`;
        queryCountryWiseContacts += ` AND (${conditions})`;
        queryCountryWiseUniqueCompanies += ` AND (${conditions})`;
        querySelectAll += ` AND (${conditions})`;
  
        filterConditions[key].forEach(value => {
          if (typeof value === 'string') {
            if (useSimilarTo) {
              // Prepare value for SIMILAR TO with wildcard matching
              params.push(`%(${value.trim()})%`);
            } else {
              params.push(value.trim());
            }
          } else {
            params.push(value); // Push the value as is if not a string
          }
        });
      }
    }
  };
  
  
  
  // Add conditions
  addConditions('job_title', 'job_title', true);
  addConditions('Company_Name', '"Company_Name"');
  addConditions('domain', 'domain');
  addConditions('Industry_Type', '"Industry_Type"', true);
  addConditions('Revenue_Size', 'Revenue_Size');
  addConditions('job_function', 'job_function');
  addConditions('job_level', 'job_level');
  addConditions('country', 'country');
  addConditions('state', 'state');
  addConditions('Sub_Industry', 'Sub_Industry', true);
  addConditions('Employee_Size', '"Employee_Size"', true);
  
  // Group by country for these queries
  queryCountryWiseContacts += ' GROUP BY country';
  queryCountryWiseUniqueCompanies += ' GROUP BY country';

  console.log('Final Query Count Rows:', queryCountRows);
  console.log('Final Query Count Unique Companies:', queryCountUniqueCompanies);
  console.log('Final Query Country Wise Contacts:', queryCountryWiseContacts);
  console.log('Final Query Country Wise Unique Companies:', queryCountryWiseUniqueCompanies);
  console.log('Final Query Select All:', querySelectAll); // Debugging line
  console.log('Parameters:', params);

  try {
    // Get total row count (overall)
    const countRowsResult = await pool.query(queryCountRows, params);
    const totalContacts = countRowsResult.rows[0].total_contacts;

    // Get unique company count (overall)
    const countUniqueCompaniesResult = await pool.query(queryCountUniqueCompanies, params);
    const uniqueCompanies = countUniqueCompaniesResult.rows[0].unique_companies;

    // Get total row count grouped by country
    const countCountryWiseContactsResult = await pool.query(queryCountryWiseContacts, params);
    const totalContactsByCountry = countCountryWiseContactsResult.rows;

    // Get unique company count grouped by country
    const countCountryWiseUniqueCompaniesResult = await pool.query(queryCountryWiseUniqueCompanies, params);
    const uniqueCompaniesByCountry = countCountryWiseUniqueCompaniesResult.rows;

    // Get all rows for exporting
    const selectAllResult = await pool.query(querySelectAll, params);
    const excelFilePath = exportToExcel(selectAllResult.rows);

    // Render the results page with download link
    res.render('results', {
      totalContacts,
      uniqueCompanies,
      totalContactsByCountry,
      uniqueCompaniesByCountry,
      excelFileUrl: '/download/excel' // URL for downloading the Excel file
    });
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('Internal Server Error');
  } finally {
    // Clean up uploaded file
    fs.unlinkSync(filePath);
  }
});

// Route to handle Excel file download
app.get('/download/excel', (req, res) => {
  const filePath = path.join(__dirname, 'temp_exported_data.xlsx');

  res.download(filePath, 'exported_data.xlsx', (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(500).send('Internal Server Error');
    } else {
      // Clean up file after download
      fs.unlinkSync(filePath);
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
