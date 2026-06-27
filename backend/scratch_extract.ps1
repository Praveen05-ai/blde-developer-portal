Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('C:\Users\IIC 05\Desktop\BLDE_EDC_Pilot_Deployable_v1.zip')
$entry = $zip.Entries | Where-Object { $_.FullName -like "*blde_edc.sqlite" }
if ($entry -ne $null) {
    # If there are multiple entries (e.g. backup versions), take the active one
    $activeEntry = $entry | Where-Object { $_.FullName -like "*storage/database/blde_edc.sqlite" }
    if ($activeEntry -eq $null) {
        $activeEntry = $entry[0]
    }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($activeEntry, 'C:\Users\IIC 05\Desktop\temp_extract_test_db.sqlite', $true)
    Write-Output "Extracted: $($activeEntry.FullName)"
} else {
    Write-Output "Not found"
}
$zip.Dispose()
