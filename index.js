//@ts-check
const express = require('express');
const morgan = require('morgan')
const queue = require('express-queue');
const fs = require('fs');
var bodyParser = require('body-parser')
const multer = require('multer');
const MongoClient = require('mongodb').MongoClient;
var upload = multer({ dest: 'uploads/' })
const config = require('./config.json');
const app = express();
app.use(bodyParser.urlencoded());
app.use(bodyParser.json());

// log all requests to access.log
app.use(morgan('tiny'))

let availableTargets = [];
let activeCounters= {};
let targetLeftovers = {};

let oldClientTarget = 0;

let activeCounter = 0;
let maxCount = 0;
let existingInputs = {}
let existingOutputs = {}

const dbName = 'covid';
const client = new MongoClient(config.mongo);


let db;

client.connect(function(err) {
    console.log("Connected successfully to mongo");
    db = client.db(dbName);
});

setInterval(()=>{
    handleExistingFiles()
}, 1000 * 60 * 125)

app.use((req, res, next)=>{
    var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (db) {
        let history = db.collection('history')
        history.insertOne({ip, path: req.path, method: req.method, timestamp: new Date()});
    }
    next();
})

app.get('/target', (req, res)=>{
    for (var i = 0; i < availableTargets.length; i++){
        let leftovers = getAvailableLeftovers(availableTargets[i]);
        if (leftovers.length == 0 && activeCounters[availableTargets[i]] >= maxCount) {
            continue;
        } 
        return res.end(String(availableTargets[i]));
    }
    res.end(String(-1));
    
});

app.get('/counter', queue({activeLimit: 1, queuedLimit: -1}), (req, res)=>{


    let existsTarget = false;
    for (var i = 0; i < availableTargets.length; i++){
        let leftovers = getAvailableLeftovers(availableTargets[i]);
        if (leftovers.length == 0 && activeCounters[availableTargets[i]] >= maxCount) {
            continue;
        } 
        existsTarget = true;
        oldClientTarget = availableTargets[i];
        break;
    }
    if (!existsTarget) return res.end(String(-1));
    let num = getCounter(oldClientTarget)
    if (num == -2) {
        res.redirect(`/${oldClientTarget}/counter`)
    } else {
        res.end(String(num))
    }
})

function getCounter(id){
    let leftovers = getAvailableLeftovers(id)
    if (leftovers.length == 0) {
        //increase counter until we found nuber that it has a test
        do {
            activeCounters[id]++;
        } while(isPackageNotAvailable(activeCounters[id], id) || isPackageSolved(activeCounters[id], id))

        //Check if over top
        if (activeCounters[id] >= maxCount || (Object.keys(existingInputs).length > 0 && existingInputs[activeCounter] == undefined)){
            console.log(-1)  
            return -1;     
        } else {
            let l = isLeftover(activeCounter, id);
            if (!l.isAvailable) {
                return -2
            }
            if (!l.isLeftover) {
                targetLeftovers[id].push({
                    number: activeCounter,
                    lastTry: new Date(),
                })
            }
            console.log(activeCounter)
            return activeCounter;
            //res.end(String(activeCounter));
           //TUAKJ OSTAL
        }
    } else {
        let picked = leftovers[0]
        while (existingOutputs[id][picked.number]==true) {
            picked.lastTry = new Date();
            leftovers = getAvailableLeftovers()
            if (leftovers.length == 0) {
                return -2
                //return res.redirect('/counter');
            }
            picked = leftovers[0]
        }
        picked.lastTry = new Date();
        console.log(picked.number);
        return picked.number;
        //res.end(String(picked.number));
        //console.log(picked.number)
    }
}

app.get('/:id/counter', queue({activeLimit: 1, queuedLimit: -1}), (req, res)=>{
    let {id} = req.params;
    let leftovers = getAvailableLeftovers(id)
    if (leftovers.length == 0) {
        //increase counter until we found nuber that it has a test
        do {
            activeCounters[id]++;
        } while(isPackageNotAvailable(activeCounters[id], id) || isPackageSolved(activeCounters[id], id))

        //Check if over top
        if (activeCounters[id] >= maxCount || (Object.keys(existingInputs).length > 0 && existingInputs[activeCounter] == undefined)){
            res.end(String(-1));      
            console.log(-1)  
        } else {
            let l = isLeftover(activeCounter, id);
            if (!l.isAvailable) {
                return res.redirect('/counter');
            }
            if (!l.isLeftover) {
                targetLeftovers[id].push({
                    number: activeCounter,
                    lastTry: new Date(),
                })
            }
            res.end(String(activeCounter));
            console.log(activeCounter)
           //TUAKJ OSTAL
        }
    } else {
        let picked = leftovers[0]
        while (existingOutputs[id][picked.number]==true) {
            picked.lastTry = new Date();
            leftovers = getAvailableLeftovers()
            if (leftovers.length == 0) {
                return res.redirect('/counter');
            }
            picked = leftovers[0]
        }
        picked.lastTry = new Date();
        res.end(String(picked.number));
        console.log(picked.number)
    }
})

app.get('/file/down/:counter', (req, res)=>{
    let {counter} = req.params;
    res.redirect(`/${oldClientTarget}/file/down/${counter}`)
})

app.get('/:id/file/down/:counter', (req, res)=>{
    let {counter, id} = req.params;
    try{
        res.download(`${config.path}/compounds/3D_structures_${counter}.sdf`)
    } catch (err){
        console.error("Error downloading file, ",err);
        res.status(402);
        res.end()
    }
})

app.get('/file/target/test_pro', (req, res)=>{
    res.redirect(`/${oldClientTarget}/file/target/test_pro`)
})

app.get('/:id/file/target/test_pro', (req, res)=>{
    let {id} = req.params;
    try{
        res.download(`${config.path}/targets/${id}/targets/TEST_PRO.pdb`)
    } catch (err){
        console.error("Error downloading file, ",err);
        res.status(402);
        res.end()
    }
})

app.get('/file/target/test_ref', (req, res)=>{
    res.redirect(`/${oldClientTarget}/file/target/test_ref`)
})

app.get('/:id/file/target/test_ref', (req, res)=>{
    let {id} = req.params;
    try{
        res.download(`${config.path}/targets/${id}/targets/TEST_REF.sdf`)
    } catch (err){
        console.error("Error downloading file, ",err);
        res.status(402);
        res.end()
    }
})

app.post('/file/:counter', upload.single("data"), (req, res)=>{
    if (req.body.apikey != config.apiKey){
        res.status(401);
        res.end();
        return
    }
    let { counter} = req.params;
    try{
        fs.renameSync(__dirname+`/uploads/${req.file.filename}`, `${config.path}/targets/${oldClientTarget}/up/OUT_${counter}.sdf`)
        res.end();
        existingOutputs[oldClientTarget][counter] = true;
    } catch(err){
        console.error('Error moving file', err)
        res.status(401);
        res.end();
    }
});

app.post('/:id/file/:counter', upload.single("data"), (req, res)=>{
    if (req.body.apikey != config.apiKey){
        res.status(401);
        res.end();
        return
    }
    let {id, counter} = req.params;
    try{
        fs.renameSync(__dirname+`/uploads/${req.file.filename}`, `${config.path}/targets/${id}/up/OUT_${counter}.sdf`)
        existingOutputs[id][counter] = true;
        res.end();
    } catch(err){
        console.error('Error moving file', err)
        res.status(401);
        res.end();
    }
});

app.get('/current', (req, res)=>{
    let out = ""
    availableTargets.forEach(t=>{
        out += `${t}: ${activeCounters[t]}\n`
    })
    res.end(out)
})

app.get('/latest', (req, res)=>{
    res.download(__dirname+'/run_flexx.latest.exe');
})

app.get('/latest-version', (req, res)=>{
    let version = fs.readFileSync(__dirname+'/version.latest', 'utf8');
    res.end(version);
})

app.get('/reset', (req, res)=>{
    handleExistingFiles()
    res.end();
})

app.get('/max', (req, res)=>{
    res.end(String(maxCount));
})
app.get('/leftovers', (req, res)=>{
    let out = "";

    availableTargets.forEach(t=>{
        out += `${t}: ${JSON.stringify(getAvailableLeftovers(t).map(a=>a.number ))}\n`
    })
    res.end(out);
})

app.get('/leftovers-all', (req, res)=>{
    let out = ""
    availableTargets.forEach(t=>{
        out += `${t}: ${JSON.stringify(targetLeftovers[t])}\n`
    })
    res.end(out);
})

app.get('/old', (req,res)=>{
    res.end(String(oldClientTarget))
})

app.get('/health', (req, res)=>{
    res.end('ok');
});

app.use("*", (req,res)=>{
    res.status(404)
    res.end();
})

function isPackageNotAvailable(counter, target){
    if (Object.keys(existingInputs).length == 0 || counter >= maxCount) return false
    if (existingInputs[counter] != true ) return true 
}

function isPackageSolved(counter, target) {
    if (existingOutputs[target][counter]) return true;
    return false;
}

function getAvailableLeftovers(targetID){
    let currentDate = new Date();
    let beforeDate = currentDate.setHours(currentDate.getHours() - 2);
    return targetLeftovers[targetID].filter(a=> a.lastTry < beforeDate);

}

function isLeftover(number, target){
    let l = targetLeftovers[target].find(a=>a.number == number);
    let currentDate = new Date();
    if (l){
        if (l.lastTry < currentDate) {
            return {isLeftover: true, isAvailable: true }
        }
        return {isLeftover: true, isAvailable: false }

    }
    return {isLeftover: false, isAvailable: true }
}


app.listen(8888, ()=>{
    console.log('Server started listening on port 8888')
});
handleExistingFiles();

function handleExistingFiles(){
    //Get all targets
    let targets = fs.readdirSync(`${config.path}/targets`)
    if (!targets) {
        console.error("Error reading targets")
        return;
    }
    targets = targets.filter(a=>a != "sets");
    targets.forEach(t=>{
        let target = parseInt(t);
        if (!isNaN(target)){
            availableTargets.push(target);
        }
    })
    oldClientTarget = availableTargets[0];


    //Get existing input files 
    let existing = fs.readdirSync(`${config.path}/compounds`);
    if (!existing){ return; }
    let filteredExisting = existing.filter(a=>a.match(/3D_structures_/)).map(a=>parseInt(a.split('.')[0].replace('3D_structures_', '')));

    let max = 0;
    filteredExisting.forEach(e=>{
        existingInputs[e] = true;
        if (e > max) {
            max = e;
        }
    })
    maxCount = max;

    //Get existing output files for each target
    availableTargets.forEach(t=>{
        handleExistingOutputs(t)
    })


    //Get max counts for each file
}

function handleExistingOutputs(targetID){
    activeCounters[targetID] = 0;
    existingOutputs[targetID] = {};
    let outputFiles = fs.readdirSync(`${config.path}/targets/${targetID}/up`);
    if (!outputFiles) return;

    let filtered = outputFiles.filter(a=>a.match(/OUT_/)).map(a=>parseInt(a.split('.')[0].replace('OUT_', '')));
    let max = 0;
    let map = {}
    filtered.forEach(a=>{
        if (a > max) {
            max = a;
        }
        map[a] = true;
        existingOutputs[targetID][a] = true;
    })
    let currentDate = new Date();
    let beforeDate = currentDate.setHours(currentDate.getHours() - 2);
    let oldLeftovers = targetLeftovers[targetID];
    if (!oldLeftovers) oldLeftovers = [];
    targetLeftovers[targetID] = [];
    for (var i = 1; i < max; i++) {
        if (!map[i]) {
            if (existingInputs[i]){
                let old = oldLeftovers.find(a=>a.number == i);
                if (old) {
                    targetLeftovers[targetID].push(old);
                } else {
                    targetLeftovers[targetID].push({
                        number: i,
                        lastTry: beforeDate,
                    })
                }
            }
        }
    }
    activeCounters[targetID] = max;
}
