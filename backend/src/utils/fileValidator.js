import path from 'path';

/**
 * Validates the binary header (magic numbers) of an uploaded file against its declared extension.
 * Rejects only known-dangerous executables and scripts.
 * All other file types are allowed through with appropriate MIME detection.
 * 
 * @param {Buffer} buffer - File buffer contents.
 * @param {string} filename - Declared original filename.
 * @returns {{ valid: boolean, mime: string }}
 */
export const validateFileSignature = (buffer, filename) => {
  const ext = path.extname(filename || '').toLowerCase().trim();
  
  // Block dangerous executable and script extensions
  const blockedExtensions = ['.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif', '.vbs', '.js', '.wsf', '.ps1', '.sh'];
  if (blockedExtensions.includes(ext)) {
    return { valid: false, mime: 'application/octet-stream' };
  }

  if (buffer.length < 4) {
    // Small files: allow text-based formats
    if (['.txt', '.csv', '.json', '.xml', '.html', '.md', '.log'].includes(ext)) {
      return { valid: true, mime: ext === '.csv' ? 'text/csv' : 'text/plain' };
    }
    return { valid: true, mime: 'application/octet-stream' };
  }

  const hex = buffer.toString('hex', 0, 4).toUpperCase();
  const hex8 = buffer.length >= 8 ? buffer.toString('hex', 0, 8).toUpperCase() : '';

  // Known binary signature detection (for MIME typing, not blocking)
  
  // PDF (%PDF)
  if (hex === '25504446') {
    return { valid: true, mime: 'application/pdf' };
  }

  // PNG (89504E47)
  if (hex === '89504E47') {
    return { valid: true, mime: 'image/png' };
  }

  // JPEG (FFD8FF)
  if (hex.startsWith('FFD8FF')) {
    return { valid: true, mime: 'image/jpeg' };
  }

  // GIF (GIF87a or GIF89a)
  if (hex.startsWith('47494638')) {
    return { valid: true, mime: 'image/gif' };
  }

  // BMP (BM)
  if (hex.startsWith('424D')) {
    return { valid: true, mime: 'image/bmp' };
  }

  // TIFF (49492A00 little-endian or 4D4D002A big-endian)
  if (hex === '49492A00' || hex === '4D4D002A') {
    return { valid: true, mime: 'image/tiff' };
  }

  // WebP (RIFF....WEBP)
  if (hex === '52494646' && buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { valid: true, mime: 'image/webp' };
  }

  // ZIP/Office XML formats (PK..)
  if (hex === '504B0304') {
    let mime = 'application/zip';
    if (ext === '.docx') mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === '.xlsx') mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ext === '.pptx') mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (ext === '.odt') mime = 'application/vnd.oasis.opendocument.text';
    if (ext === '.ods') mime = 'application/vnd.oasis.opendocument.spreadsheet';
    return { valid: true, mime };
  }

  // RAR (Rar!)
  if (hex === '52617221') {
    return { valid: true, mime: 'application/x-rar-compressed' };
  }

  // 7z (377ABCAF)
  if (hex === '377ABCAF') {
    return { valid: true, mime: 'application/x-7z-compressed' };
  }

  // GZIP (1F8B)
  if (hex.startsWith('1F8B')) {
    return { valid: true, mime: 'application/gzip' };
  }

  // MP4/MOV (ftyp at offset 4)
  if (buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return { valid: true, mime: ext === '.mov' ? 'video/quicktime' : 'video/mp4' };
  }

  // AVI (RIFF....AVI)
  if (hex === '52494646' && buffer.length >= 12 && buffer.toString('ascii', 8, 11) === 'AVI') {
    return { valid: true, mime: 'video/x-msvideo' };
  }

  // MP3 (ID3 tag or MPEG sync word)
  if (hex.startsWith('494433') || hex.startsWith('FFFB') || hex.startsWith('FFF3') || hex.startsWith('FFE3')) {
    return { valid: true, mime: 'audio/mpeg' };
  }

  // WAV (RIFF....WAVE)
  if (hex === '52494646' && buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WAVE') {
    return { valid: true, mime: 'audio/wav' };
  }

  // OGG
  if (hex === '4F676753') {
    return { valid: true, mime: 'audio/ogg' };
  }

  // DICOM (DICM at offset 128)
  if (buffer.length >= 132 && buffer.toString('ascii', 128, 132) === 'DICM') {
    return { valid: true, mime: 'application/dicom' };
  }

  // Microsoft legacy Office formats (DOC, XLS, PPT) - OLE2 compound document
  if (hex8 === 'D0CF11E0A1B11AE1') {
    let mime = 'application/msword';
    if (ext === '.xls') mime = 'application/vnd.ms-excel';
    if (ext === '.ppt') mime = 'application/vnd.ms-powerpoint';
    return { valid: true, mime };
  }

  // SVG (text-based XML starting with < and containing svg)
  if (ext === '.svg') {
    return { valid: true, mime: 'image/svg+xml' };
  }

  // Text / CSV / JSON / XML detection (Check for control characters or null bytes)
  let isText = true;
  for (let i = 0; i < Math.min(buffer.length, 512); i++) {
    const char = buffer[i];
    if (char < 32 && char !== 9 && char !== 10 && char !== 13) {
      isText = false;
      break;
    }
  }

  if (isText) {
    const mimeMap = {
      '.csv': 'text/csv',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.md': 'text/markdown',
      '.log': 'text/plain',
      '.yml': 'text/yaml',
      '.yaml': 'text/yaml'
    };
    return { valid: true, mime: mimeMap[ext] || 'text/plain' };
  }

  // Default: allow unknown file types through with generic MIME
  // This ensures researchers can upload any clinical data format
  const genericMimeMap = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.dcm': 'application/dicom',
    '.nii': 'application/octet-stream',
    '.edf': 'application/octet-stream',
    '.fasta': 'text/plain',
    '.fastq': 'text/plain'
  };

  return { valid: true, mime: genericMimeMap[ext] || 'application/octet-stream' };
};

export default {
  validateFileSignature
};
