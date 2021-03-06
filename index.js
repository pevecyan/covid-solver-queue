//@ts-check
const express = require('express'),
    morgan = require('morgan'),
    queue = require('express-queue'),
    fs = require('fs'),
    multer = require('multer'),
    MongoClient = require('mongodb').MongoClient,
    Path = require('path'),
    zipper = require("zip-local"),
     mysql = require('mysql'),  
     naturalSort=require('javascript-natural-sort'); 

const colors = require('colors/safe'); 
const config = require('./config.json');
const dockingConfig = require('./dockingConfig.json');
var upload = multer({dest: `${config.path}/uploads/`}); 
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
var mysqlconn;

function createConnMysql() {
     mysqlconn = mysql.createConnection({ 
	host: config.mysqlHost, 
	user: config.mysqlUser, 
	password: config.mysqlPass, 
	database: config.mysqlDb 
});
}

function connectMysql() { 
	mysqlconn.connect(function(err) { 
		if (err) throw err;	  
		console.log(colors.yellow("Mysql Connected")); 
	});  
} 

const dbName = 'covid';
const client = new MongoClient(config.mongo, {useUnifiedTopology: true});
let db;

let uploadBlacklist = {}
let uploadPenalty = {}

const minCounter = 0;

client.connect(function (err) {
    startServer();
    if (err) return console.error(err);
    console.log("Connected successfully to mongo");
    db = client.db(dbName);
});

//connectMysql();
function startServer() {
    console.log('Started existing files handle');
    handleExistingFiles();
    console.log('Existing files handled');
    app.listen(config.proxyPort, () => {	// bostjan
        console.log('Server started listening on port %d',config.proxyPort) 
    });
}

setInterval(() => {
    handleExistingFiles()
}, 1000 * 60 * 125);

app.use((req, res, next) => {	
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    req.requestIP = ip;
    if (uploadBlacklist[ip]) {
        res.status(403);
        res.end();
        return;
    }
    let {ClientGUID, ThreadCount, Client} = req.body; 
    console.log(req.body);
    if (req.method === 'POST' && !req.path.match(/\/[0-9]+\/file\/[0-9]+/)) { 
     if (db) {
        let history = db.collection(config.collection); 
        let data = {ip, path: req.path, method: req.method, timestamp: new Date(), ClientGUID, ThreadCount, Client}; 
        if (ClientGUID) {
            data.ClientGUID = ClientGUID;
        }
        if (ThreadCount) {
            data.ThreadCount = ThreadCount;
        }
	if (Client) { 
	    data.Client = Client; 
	} 
        history.insertOne(data);
     }
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
    let {counter} = req.params;
    let {zipFlag} = req.query;
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

app.post('/:id/file/:counter', upload.single("data"), (req, res) => {
    if (req.body.apikey !== config.apiKey) {
        res.status(401);
        res.end();
        return
    }
   const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
   let {ClientGUID, ThreadCount, Client} = req.body; 
   let {zipFlag} = req.query;
   let {id, counter} = req.params;
    if (db) {
        let history = db.collection(config.collection); 
        let data = {ip, path: req.path, method: req.method, timestamp: new Date(), ClientGUID, ThreadCount, Client}; 
        if (ClientGUID) {
            data.ClientGUID = ClientGUID;
        }
        if (ThreadCount) {
            data.ThreadCount = ThreadCount;
        }
	if (Client) { 
	    data.Client = Client; 
	} 
        history.insertOne(data);
     }
    try {
        let file = fs.statSync(`${config.path}/uploads/${req.file.filename}`); 
        if (file.size == 0) {
            fs.unlinkSync(`${config.path}/uploads/${req.file.filename}`)             
            if (uploadPenalty[req.requestIP]) {
                uploadPenalty[req.requestIP]++;
                if (uploadPenalty[req.requestIP] > 4) {
                    uploadBlacklist[req.requestIP] = setTimeout(()=>{
                        delete uploadBlacklist[req.requestIP];
                        delete uploadPenalty[req.requestIP];
                    }, 1000 * 60 * 120)
                }
            } else {
                uploadPenalty[req.requestIP] = 1;
            }
        } else {
            if (uploadPenalty[req.requestIP]) {
                delete uploadPenalty[req.requestIP]
            }
            if (zipFlag) {
                fs.renameSync(`${config.path}/uploads/${req.file.filename}`, `${config.path}/targets/${id}/up/OUT_${counter}.sdf.zip`) 
            } else {
                fs.renameSync( `${config.path}/uploads/${req.file.filename}`, `${config.path}/targets/${id}/up/OUT_${counter}.sdf`) 
            }
            existingOutputs[id][counter] = true;
        }
        res.end();
    } catch (err) {
        console.error('Error moving file', err);
        res.status(401);
        res.end();
    }
});

app.get('/blacklist', (req, res)=>{
    res.end(JSON.stringify(Object.keys(uploadBlacklist)));
})

app.get('/results-done', (req, res) => {
	let out="";
	let param=req.query; //target number
	fs.readdir(`${config.path}/targets/`+param["t"]+`/up`,(err,files) => {
		if (err) {
			console.log("No files found");
			out = ("No target data found");
			res.end(out);
		} else
		{
			console.log(`${config.path}/targets/`+param["t"]+`/up`);
			let existingFiles = files.length;
			fs.readdir(`${config.path}/compounds_zipped`,(err2,files2) =>{
				if (err2) {
					console.log("No compounds found");
					out = "" + existingFiles + ";99999";
					res.end(out);
				} else
				{
					console.log(`${config.path}/compounds_zipped`);
					let existingCompounds = files2.length;
					console.log(colors.yellow("Existing files for target "+param["t"]+": " + existingFiles + ";" + existingCompounds));
					out = "" + existingFiles + ";" + existingCompounds;
					res.end(out);
				}
			});
		}
	});
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

app.get('/messages',(req,res) =>{
	let {LastMsgRead} = req.query;
	let out="";
	timenow = new Date().toISOString().slice(0,19).replace('T',' ');
	createConnMysql();
	connectMysql();
	console.log(colors.yellow("Connected to mysql"));
	let mysqlquery = "select * from covid_messages where validFrom <='" + timenow + "' and validTo >= '" + timenow + "'";
	if (LastMsgRead) {
		mysqlquery += " and id> " + LastMsgRead;
	}
	mysqlconn.query(mysqlquery,function(err,result,fields){
		if (err) throw (err);
		console.log(colors.yellow("Data read from mysql"));
		out = JSON.stringify(result);
		console.log(colors.red("/MESSAGES result: ") + out);
		mysqlconn.end();
		console.log(colors.yellow("Disconnected from mysql"));
		res.end(out);
	});
});

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


deleteFolderRecursive(`${config.path}/uploads`) 
fs.mkdirSync(`${config.path}/uploads`) 
//handleExistingFiles();


function deleteFolderRecursive(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach((file, index) => {
            const curPath = Path.join(path, file);
            if (fs.lstatSync(curPath).isDirectory()) { //recurse
                deleteFolderRecursive(curPath);
            } else { //delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}

function handleExistingFiles() {
    console.log(dockingConfig)
    //Get all targets
    availableTargets = dockingConfig.targets;
    //Sort probably not required, since it is being sorted by config file

    //Get existing input files 
    let existing = fs.readdirSync(`${config.path}/compounds_zipped`);
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
    availableTargets.forEach(t => {
        let target = t.id;
        if (!isNaN(target)) {
            let files = fs.readdirSync(`${config.path}/targets/${target}/targets`);
            files = files.filter(f=> f.match(/.+\.zip/));

            files.forEach(f=>{
                fs.unlinkSync(`${config.path}/targets/${target}/targets/${f}`)
            })
            //zipping a directory to disk with compression
            //the directory has the following structure
            //|-- hello-world.txt
            //|-- cpp
            //|-- hello-world.cpp
            //|-- java
            //|--hello-world.java
            zipper.sync.zip(`${config.path}/targets/${target}/targets/`).compress()
                .save(`${config.path}/targets/${target}/targets/archive.zip`);
        }
    });
}

function handleExistingOutputs(target) {
    let targetID = target.id;
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
            target.packages.forEach(p=>{
                if (existingInputs[i] && i >= p.start && i < p.end) {
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
            })
            
        }
    }
    activeCounters[targetID] = Math.max(max, minCounter);
}
