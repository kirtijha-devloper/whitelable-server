const fs = require('fs');
const path = require('path');
const db = require('./config/database');

async function run() {
  try {
    console.log('Querying BillAvenueBillers from database...');
    const [results] = await db.query('SELECT biller_id, biller_name, category, service_type, circle, state, is_active, metadata FROM "BillAvenueBillers"');
    console.log(`Fetched ${results.length} billers from PostgreSQL.`);

    if (results.length === 0) {
      console.log('No billers found in database.');
      process.exit(0);
    }

    const seederFile = 'd:/AbheePay/PARTNER-PG/database/seeders/BillAvenueBillerSeeder.php';
    
    let code = `<?php

namespace Database\\Seeders;

use Illuminate\\Database\\Console\\Seeds\\WithoutModelEvents;
use Illuminate\\Database\\Seeder;
use Illuminate\\Support\\Facades\\DB;

class BillAvenueBillerSeeder extends Seeder
{
    /**
     * Run the database seeds.
     *
     * @return void
     */
    public function run()
    {
        $billers = [
`;

    for (const row of results) {
      const escapePhpString = (str) => {
        if (!str) return 'null';
        return "'" + str.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\'") + "'";
      };

      const billerId = escapePhpString(row.biller_id);
      const billerName = escapePhpString(row.biller_name);
      const category = escapePhpString(row.category || 'Credit Card');
      const serviceType = escapePhpString(row.service_type);
      const circle = escapePhpString(row.circle);
      const state = escapePhpString(row.state);
      const isActive = row.is_active ? 'true' : 'false';
      
      let metadata = 'null';
      if (row.metadata) {
        // Stringify metadata object, and escape for PHP string
        const metaStr = typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata);
        metadata = escapePhpString(metaStr);
      }

      code += `            [
                'biller_id' => ${billerId},
                'biller_name' => ${billerName},
                'category' => ${category},
                'service_type' => ${serviceType},
                'circle' => ${circle},
                'state' => ${state},
                'is_active' => ${isActive},
                'metadata' => ${metadata},
                'created_at' => now(),
                'updated_at' => now()
            ],
`;
    }

    code += `        ];

        foreach ($billers as $biller) {
            DB::table('bill_avenue_billers')->updateOrInsert(
                ['biller_id' => $biller['biller_id']],
                [
                    'biller_name' => $biller['biller_name'],
                    'category' => $biller['category'],
                    'service_type' => $biller['service_type'],
                    'circle' => $biller['circle'],
                    'state' => $biller['state'],
                    'is_active' => $biller['is_active'],
                    'metadata' => $biller['metadata'],
                    'created_at' => $biller['created_at'],
                    'updated_at' => $biller['updated_at']
                ]
            );
        }
    }
}
`;

    fs.writeFileSync(seederFile, code);
    console.log(`Successfully generated Laravel Seeder file at: ${seederFile}`);
    process.exit(0);

  } catch (err) {
    console.error('Error extracting billers:', err);
    process.exit(1);
  }
}

run();
