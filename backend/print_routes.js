import app from './src/app.js';

function print(path, layer) {
  if (layer.route) {
    layer.route.stack.forEach(print.bind(null, path + (path.endsWith('/') ? '' : '/') + layer.route.path));
  } else if (layer.name === 'router' && layer.handle.stack) {
    layer.handle.stack.forEach(print.bind(null, path + (path.endsWith('/') ? '' : '/') + (layer.regexp.source.split('\\/').filter(x => x && !x.startsWith('?')).join('/') || '')));
  } else if (layer.method) {
    console.log('%s /api/%s', layer.method.toUpperCase(), path);
  }
}

app._router.stack.forEach(print.bind(null, ''));
