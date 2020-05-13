//@ts-check
const express = require('express'),
    morgan = require('morgan'),
    queue = require('express-queue'),
    fs = require('fs'),
    multer = require('multer'),
    MongoClient = require('mongodb').MongoClient,
    zipper = require("zip-local");
var upload = multer({dest: 'uploads/'});
const config = require('./config.json');
const app = express();

app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use(morgan('tiny'));

let availableTargets = [];
let activeCounters = {};
let targetLeftovers = {};

let oldClientTarget = 0;

let maxCount = 0;
let existingInputs = {};
let existingOutputs = {};

const dbName = 'covid';
const client = new MongoClient(config.mongo, {useUnifiedTopology: true});

let db;

const minCounter = 1300;

client.connect(function (err) {
    startServer();
    if (err) return console.error(err);
    console.log("Connected successfully to mongo");
    db = client.db(dbName);
});

function startServer() {

    app.listen(8888, () => {
        console.log('Server started listening on port 8888')
    });
}

setInterval(() => {
    handleExistingFiles()
}, 1000 * 60 * 125);

app.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    let {ClientGUID, ThreadCount} = req.body;
    if (db) {
        let history = db.collection('history');
        history.insertOne({ip, path: req.path, method: req.method, timestamp: new Date(), ClientGUID, ThreadCount});
    }
    next();
});

app.use((req, res, next) => {
    if (req.method === 'POST' && !req.path.match(/\/[0-9]+\/file\/[0-9]+/) && req.body.apikey !== config.apiKey) {
        res.status(401);
        res.end();
        return;
    }
    next();
})

app.post('/target', (req, res) => {
    for (var i = 0; i < availableTargets.length; i++) {
        let leftovers = getAvailableLeftovers(availableTargets[i]);
        if (leftovers.length === 0 && activeCounters[availableTargets[i]] >= maxCount) {
            continue;
        }
        return res.end(String(availableTargets[i]));
    }
    res.end(String(-1));
    setTimeout(()=>{
        process.exit()//This will reset leftovers
    })

});

app.post('/:id/counter', queue({activeLimit: 1, queuedLimit: -1}), (req, res) => {
    let {id} = req.params;
    let leftovers = getAvailableLeftovers(id);
    if (leftovers.length === 0) {
        //increase counter until we found nuber that it has a test
        do {
            activeCounters[id]++;
        } while (isPackageNotAvailable(activeCounters[id], id) || isPackageSolved(activeCounters[id], id))

        //Check if over top
        if (activeCounters[id] > maxCount || (Object.keys(existingInputs).length > 0 && existingInputs[activeCounters[id]] == undefined)) {
            res.end(String(-1));
            console.log(-1)
        } else {
            let l = isLeftover(activeCounters[id], id);
            if (!l.isAvailable) {
                return res.redirect('/counter');
            }
            if (!l.isLeftover) {
                targetLeftovers[id].push({
                    number: activeCounters[id],
                    lastTry: new Date(),
                })
            }
            res.end(String(activeCounters[id]));
            console.log(activeCounters[id])
        }
    } else {
        let picked = leftovers[0];
        while (existingOutputs[id][picked.number] === true) {
            picked.lastTry = new Date();
            leftovers = getAvailableLeftovers(id);
            if (leftovers.length === 0) return res.redirect('/counter');
            picked = leftovers[0]
        }
        picked.lastTry = new Date();
        res.end(String(picked.number));
        console.log(picked.number)
    }
});

app.post('/:id/file/down/:counter', (req, res) => {
    let {counter, zipFlag} = req.params;
    if (zipFlag) {
        try {
            res.download(`${config.path}/compounds_zipped/3D_structures_${counter}.sdf.zip`)
        } catch (err) {
            console.error("Error downloading file, ", err);
            res.status(402);
            res.end()
        }
    } else {
        try {
            res.download(`${config.path}/compounds/3D_structures_${counter}.sdf`)
        } catch (err) {
            console.error("Error downloading file, ", err);
            res.status(402);
            res.end()
        }
    }
});

app.post('/:id/file/target/archive', (req, res) => {
    let {id} = req.params;
    try {
        res.download(`${config.path}/targets/${id}/targets/archive.zip`)
    } catch (err) {
        console.error("Error downloading file, ", err);
        res.status(402);
        res.end();
    }
});

app.post('/file/:counter', upload.single("data"), (req, res) => {
    if (req.body.apikey !== config.apiKey) {
        res.status(401);
        res.end();
        return
    }
    let {counter} = req.params;
    try {
        fs.renameSync(__dirname + `/uploads/${req.file.filename}`, `${config.path}/targets/${oldClientTarget}/up/OUT_${counter}.sdf`)
        res.end();
        existingOutputs[oldClientTarget][counter] = true;
    } catch (err) {
        console.error('Error moving file', err);
        res.status(401);
        res.end();
    }
});

app.post('/:id/file/:counter', upload.single("data"), (req, res) => {
    if (req.body.apikey !== config.apiKey) {
        res.status(401);
        res.end();
        return
    }
    let {id, counter} = req.params;
    try {
        fs.renameSync(__dirname + `/uploads/${req.file.filename}`, `${config.path}/targets/${id}/up/OUT_${counter}.sdf`)
        existingOutputs[id][counter] = true;
        res.end();
    } catch (err) {
        console.error('Error moving file', err);
        res.status(401);
        res.end();
    }
});

app.get('/current', (req, res) => {
    let out = "";
    availableTargets.forEach(t => {
        out += `${t}: ${activeCounters[t]}\n`
    });
    res.end(out)
});

app.get('/latest', (req, res) => {
    res.download(__dirname + '/run_flexx.latest.exe');
});

app.get('/latest-version', (req, res) => {
    let version = fs.readFileSync(__dirname + '/version.latest', 'utf8');
    res.end(version);
});

app.get('/reset', (req, res) => {
    handleExistingFiles();
    res.end();
});

app.get('/max', (req, res) => {
    res.end(String(maxCount));
});

app.get('/leftovers', (req, res) => {
    let out = "";

    availableTargets.forEach(t => {
        out += `${t}: ${JSON.stringify(getAvailableLeftovers(t).map(a => a.number))}\n`
    });
    res.end(out);
});

app.get('/leftovers-all', (req, res) => {
    let out = "";
    availableTargets.forEach(t => {
        out += `${t}: ${JSON.stringify(targetLeftovers[t])}\n`
    });
    res.end(out);
});

app.get('/inputs', (req, res) => {
    res.end(JSON.stringify(existingInputs));
});

app.get('/old', (req, res) => {
    res.end(String(oldClientTarget))
});


app.get('/health', (req, res) => res.end('ok'));

app.use("*", (req, res) => {
    res.status(404);
    res.end();
});


const isPackageNotAvailable = (counter, _target) => {
    if (Object.keys(existingInputs).length === 0 || counter >= maxCount) return false;
    return existingInputs[counter] !== true;
};

const isPackageSolved = (counter, target) =>
    existingOutputs[target][counter] === true;

function getAvailableLeftovers(targetID) {
    let currentDate = new Date();
    let beforeDate = currentDate.setHours(currentDate.getHours() - 2);
    try {
        return targetLeftovers[targetID].filter(a => a.lastTry < beforeDate);
    } catch (err) {
        console.log('AvailableLeftovers by target', targetID);
        console.log(err);
        return [];

    }
}

function isLeftover(number, target) {
    let l = targetLeftovers[target].find(a => a.number === number);
    let currentDate = new Date();
    if (l) {
        if (l.lastTry < currentDate) {
            return {isLeftover: true, isAvailable: true}
        }
        return {isLeftover: true, isAvailable: false}

    }
    return {isLeftover: false, isAvailable: true}
}


//app.listen(8888, () => {
//console.log('Server started listening on port 8888')
//});

handleExistingFiles();

function handleExistingFiles() {
    //Get all targets
    let targets = fs.readdirSync(`${config.path}/targets`);
    if (!targets) {
        console.error("Error reading targets");
        return;
    }
    targets = targets.filter(a => a !== "sets");
    targets.forEach(t => {
        let target = parseInt(t);
        if (!isNaN(target)) {
            if (availableTargets.indexOf(target) == -1) {
                availableTargets.push(target);
            }
        }
    });
    oldClientTarget = availableTargets[0];


    //Get existing input files 
    let existing = fs.readdirSync(`${config.path}/compounds`);
    if (!existing) {
        return;
    }
    let filteredExisting = existing.filter(a => a.match(/3D_structures_/))
        .map(a => parseInt(a.split('.')[0].replace('3D_structures_', '')));

    let max = 0;
    filteredExisting.forEach(e => {
        existingInputs[e] = true;
        if (e > max) {
            max = e;
        }
    });

    maxCount = max;

    //Get existing output files for each target
    availableTargets.forEach(t => {
        handleExistingOutputs(t)
    })


    //Zip all target data
    targets.forEach(t => {

        let files = fs.readdirSync(`${config.path}/targets/${t}/targets`);
        files = files.filter(f=> f.match(/.+\.zip/));

        files.forEach(f=>{
            fs.unlinkSync(`${config.path}/targets/${t}/targets/${f}`)
        })
        //zipping a directory to disk with compression
        //the directory has the following structure
        //|-- hello-world.txt
        //|-- cpp
        //|-- hello-world.cpp
        //|-- java
        //|--hello-world.java
        zipper.sync.zip(`${config.path}/targets/${t}/targets/`).compress()
            .save(`${config.path}/targets/${t}/targets/archive.zip`);
    });
}

function handleExistingOutputs(targetID) {
    activeCounters[targetID] = 0;
    existingOutputs[targetID] = {};
    let outputFiles = fs.readdirSync(`${config.path}/targets/${targetID}/up`);
    if (!outputFiles) return;

    let filtered = outputFiles.filter(a => a.match(/OUT_/))
        .map(a => parseInt(a.split('.')[0].replace('OUT_', '')));
    let max = 0;
    let map = {};
    filtered.forEach(a => {
        if (a > max) max = a;
        map[a] = true;
        existingOutputs[targetID][a] = true;
    });
    let currentDate = new Date();
    let beforeDate = currentDate.setHours(currentDate.getHours() - 2);
    let oldLeftovers = targetLeftovers[targetID];
    if (!oldLeftovers) oldLeftovers = [];
    targetLeftovers[targetID] = [];

    for (let i = 1; i < max; i++) {
        if (!map[i]) {
            if (existingInputs[i] && i > minCounter) {
                let old = oldLeftovers.find(a => a.number === i);
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
    activeCounters[targetID] = Math.max(max, minCounter);
}
