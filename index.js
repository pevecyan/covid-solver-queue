const express = require('express');
const morgan = require('morgan')
const queue = require('express-queue');
const ftp = require('ftp');
const fs = require('fs');
var bodyParser = require('body-parser')
const multer = require('multer');
var upload = multer({ dest: 'uploads/' })
const config = require('./config.json');
const app = express();
app.use(bodyParser.urlencoded());
app.use(bodyParser.json());

// log all requests to access.log
app.use(morgan('tiny'))

let activeCounter = 0;
let maxCount = 0;
let leftovers = [];
let existingFiles = {}

let mainConnected = false;
let mainConnection = new ftp();

let anonConnected = false;
let anonConnection = new ftp();


let targetTestPro = false;
let targetTestRef = false;

setInterval(()=>{
    if (mainConnected) {
        mainReady();
    }
}, 1000 * 60 * 125)


app.get('/counter', queue({ activeLimit: 1, queuedLimit: -1 }), (req, res)=>{
    let a = getAvailableLeftovers()
    
    if (a.length == 0) {
        do {
            activeCounter++;

        }while (Object.keys(existingFiles).length > 0 && (existingFiles[activeCounter] != true || existingFiles[activeCounter] == undefined))
        
        if (Object.keys(existingFiles).length > 0 && existingFiles[activeCounter] == undefined) {
            res.end(String(-1));      
            console.log(-1)      
        } else {
            res.end(String(activeCounter));
            console.log(activeCounter)
        }
    } else {
        let picked = a[0]
        while (Object.keys(existingFiles).length > 0 && (existingFiles[picked.number] != true || existingFiles[picked.number] == undefined)) {
            picked.lastTry = new Date();
            a = getAvailableLeftovers()
            if (a.length == 0) {
                return res.redirect('/counter');
            }
            picked = a[0]
        }
        picked.lastTry = new Date();
        res.end(String(picked.number));
        console.log(picked.number)
    }
});

app.get('/file/down/:counter', (req, res)=>{
    let counter = req.params.counter;
    let date = new Date().getTime();
    if (anonConnected) {
        anonConnection.get(`DOWN/3D_structures_${counter}.sdf`, (err, stream)=>{
            if (err) {
                console.error(err);
                res.status(402);
                res.end()
            }else {
                stream.once('close', function() { 
                    res.download(__dirname+`/3D_structures_${counter}.${date}.sdf`,`/3D_structures_${counter}.sdf`, function(err){
                        if (err) console.error(err);
                        fs.unlinkSync(__dirname+`/3D_structures_${counter}.${date}.sdf`)
                    });
                });
                stream.pipe(fs.createWriteStream(__dirname+`/3D_structures_${counter}.${date}.sdf`));
            }
        })
    } else {
        console.error("Anon not connected");
        res.status(402);
        res.end()
    }
    
})

app.get('/file/target/test_pro', (req, res)=>{

    if (targetTestPro) {
        res.download(__dirname+'/TEST_PRO.pdb');
    } else {
        if (anonConnected) {
            anonConnection.get('TARGETS/TEST_PRO.pdb', (err, stream)=>{
                if (err) {
                    console.error(err);
                    res.end(402);
                }else {
                    stream.once('close', function() { 
                        targetTestPro = true;
                        res.download(__dirname+'/TEST_PRO.pdb');
                    });
                    stream.pipe(fs.createWriteStream(__dirname+'/TEST_PRO.pdb'));
                }
            })
        }
    }
    
})

app.get('/file/target/test_ref', (req, res)=>{
    
    if (targetTestRef) {
        res.download(__dirname+'/TEST_REF.sdf');
    } else {
        if (anonConnected) {
            anonConnection.get('TARGETS/TEST_REF.sdf', (err, stream)=>{
                if (err) {
                    console.error(err);
                    res.end(402);
                }else {
                    stream.once('close', function() { 
                        targetTestRef = true;
                        res.download(__dirname+'/TEST_REF.sdf');
                    });
                    stream.pipe(fs.createWriteStream(__dirname+'/TEST_REF.sdf'));
                }
            })
        }
    }
       
    
})

app.post('/file/:counter', upload.single("data"), (req, res)=>{
    if (req.body.apikey != config.apiKey){
        res.status(401);
        res.end();
        return
    }
    if (mainConnected){
        mainConnection.put(__dirname+`/uploads/${req.file.filename}`, `files/${req.file.originalname}`, (err)=>{
            if (err) console.error(err);
            else {
                console.log("Uploaded file");
                fs.unlinkSync(__dirname+`/uploads/${req.file.filename}`)
                res.status(200);
                res.end();
            }
        })
       
    } else {
        console.error('main not connected')
        res.status(401);
        res.end();
    }
});

app.get('/current', (req, res)=>{
    res.end(String(activeCounter))
})


app.get('/reset', (req, res)=>{
    if (mainConnected) {
        mainReady();
        res.end()
    }
    res.status(401);
    res.end();
})

app.get('/max', (req, res)=>{
    res.end(String(maxCount));
})

app.get('/leftovers', (req, res)=>{
    
    res.end(JSON.stringify(getAvailableLeftovers().map(a=>a.number )));
})

app.get('/health', (req, res)=>{
    res.end('ok');
});


app.use("*", (req,res)=>{
    res.status(404)
    res.end();
})
function getAvailableLeftovers(){
    let currentData = new Date();
    currentData = currentData.setHours(currentData.getHours() - 2);
    return leftovers.filter(a=> a.lastTry < currentData)
}


app.listen(8888, ()=>{
    console.log('Server started listening on port 8888')
});
connectMain();
connectAnon();

//#region mainConnection
function connectMain(){
    mainConnected = false;
    mainConnection  = new ftp();
    mainConnection.connect({host:'ftp.molekule.net', password: config.mainPass, user:config.mainUser});
    mainConnection.on('ready', mainReady);
    mainConnection.on('error', mainError)
    mainConnection.on('close', mainClose)

}
function mainError(err){
    console.error(err);
    //setTimeout(connectMain, 10000);
}
function mainClose(err){
    console.error("Main close");
    setTimeout(connectMain, 10000);
}
function mainReady(){
    mainConnected = true;
    mainConnection.list('/files',(err, list) =>{
        if (err) console.error(err);
        if (!err){
            handleExisting(list);
        }
    });
}
function handleExisting(files){
    let filtered = files.filter(a=>a.name.match(/OUT_/)).map(a=>parseInt(a.name.split('.')[0].replace('OUT_', '')));
    let max = 0;
    let map = {};
    filtered.forEach(a=>{
        if (a > max) {
            max = a;
        }
        map[a] = true;
    })

    let currentData = new Date();
    oldLeftovers = leftovers;
    leftovers = [];
    currentData = currentData.setHours(currentData.getHours() - 2);
    for (var i = 1; i < max; i++){
        if (!map[i]){
            let old =oldLeftovers.find(a=>a.number == i)
            if (old){
                leftovers.push(old);
            } else {
                leftovers.push({
                    number: i,
                    lastTry: currentData,
                })
            }
        }
    }
    console.log('LEFTOVERS:')
    console.log(JSON.stringify(leftovers.map(a=>a.number)));
    activeCounter = max;
}
//#endregion

//#region anonConnection
function connectAnon(){
    anonConnected = false;
    anonConnection  = new ftp();
    anonConnection.connect({host:'ftp.molekule.net'})
    anonConnection.on('ready', anonReady);
    anonConnection.on('error', anonError);
    anonConnection.on('close', anonClose);

}
function anonError(err){
    console.error(err);
    //setTimeout(connectAnon, 10000);
}
function anonClose(err){
    console.error("Close");
    setTimeout(connectAnon, 10000);
}
function anonReady(){
    anonConnected = true;
    anonConnection.list('/DOWN', (err, list)=>{
        if (err) console.error(err);
        if (!err) {
            handleDown(list);
        }
    })
}
function handleDown(list){
    existingFiles = {}
    let filtered = list.filter(a=>a.name.match(/3D_structures_/)).map(a=>parseInt(a.name.split('.')[0].replace('3D_structures_', '')));
    let max = 0;
    filtered.forEach(a=>{
        existingFiles[a] = true;
        if (a > max) {
            max = a;
        }
    })
    maxCount = max;
    console.log('MAX COUNT');
    console.log(max);
    console.log(JSON.stringify(existingFiles));
}
//#endregion