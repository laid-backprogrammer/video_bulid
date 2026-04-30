import path from 'node:path';

export const parseContentDisposition = (value = '') => {
  const result = {};
  for (const part of value.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey || rawValue.length === 0) continue;
    result[rawKey.toLowerCase()] = rawValue.join('=').trim().replace(/^"|"$/g, '');
  }
  return result;
};

export const parseMultipartBody = (buffer, contentType) => {
  const boundaryMatch = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('Missing multipart boundary');
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  const files = {};
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer.slice(cursor, cursor + 2).toString('latin1') === '--') break;
    if (buffer.slice(cursor, cursor + 2).toString('latin1') === '\r\n') cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }

    const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;
    let content = buffer.slice(headerEnd + 4, nextBoundary);
    if (content.slice(-2).toString('latin1') === '\r\n') content = content.slice(0, -2);

    const disposition = parseContentDisposition(headers['content-disposition']);
    if (disposition.name) {
      if (disposition.filename) {
        files[disposition.name] = {
          filename: path.basename(disposition.filename),
          contentType: headers['content-type'] || 'application/octet-stream',
          buffer: content,
        };
      } else {
        fields[disposition.name] = content.toString('utf8');
      }
    }

    cursor = nextBoundary;
  }

  return {fields, files};
};
