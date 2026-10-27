// Local verification only; production remains Firebase Hosting / GitHub Pages.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),port=Number(args[args.indexOf('--port')+1])||4173;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2'};
http.createServer((req,res)=>{let p;try{p=decodeURIComponent(new URL(req.url,'http://local').pathname);}catch{res.writeHead(400).end();return;}if(p==='/')p='/tests/ui/gg-preview.html';const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(f,(e,b)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(b);});}).listen(port,'0.0.0.0');
