import knex from 'knex';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const tempDbPath = 'C:/Users/IIC 05/Desktop/temp_extract_test_db.sqlite';

try {
  console.log('📦 Extracting ONLY blde_edc.sqlite from the ZIP...');
  
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }

  const zipPath = 'C:/Users/IIC 05/Desktop/BLDE_EDC_Pilot_Deployable_v1.zip';
  
  // PowerShell script using .NET System.IO.Compression to extract just the one file
  const psCmd = `powershell -Command "
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath}');
    $entry = $zip.GetEntry('BLDE_EDC_Pilot_Deployable_v1/storage/database/blde_edc.sqlite');
    if ($entry -eq $null) {
        $entry = $zip.GetEntry('storage/database/blde_edc.sqlite');
    }
    if ($entry -ne $null) {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${tempDbPath}', $true);
        Write-Output 'Success';
    } else {
        Write-Error 'Entry not found';
    }
    $zip.Dispose();
  "`;
  
  const result = execSync(psCmd).toString().trim();
  console.log('PowerShell extraction result:', result);

  if (fs.existsSync(tempDbPath)) {
    const db = knex({
      client: 'sqlite3',
      connection: {
        filename: tempDbPath
      },
      useNullAsDefault: true
    });
    
    const projects = await db('projects').select('*');
    console.log(`📊 Number of projects in ZIP database: ${projects.length}`);
    projects.forEach(p => {
      console.log(`   - Project ID: ${p.id}, Title: ${p.title}`);
    });
    
    const users = await db('users').select('*');
    console.log(`👥 Number of users in ZIP database: ${users.length}`);
    users.forEach(u => {
      console.log(`   - User ID: ${u.id}, Email: ${u.email}`);
    });

    await db.destroy();
  } else {
    console.error('❌ Database file was not extracted.');
  }

} catch (err) {
  console.error('❌ Diagnostic failed:', err.message);
} finally {
  try {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
      console.log('🧹 Cleaned up temporary extraction database.');
    }
  } catch (e) {
    console.error('Warning: Cleanup failed:', e.message);
  }
}
