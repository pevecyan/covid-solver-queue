# covid-solver-queue
## api handlers (old)
- GET /target
  Returns target to wich should be all the following requests sent
  
- GET /:target//counter 
  Returns current package number that should be calculated. First we empty the leftover list (filled every two hours with lookup to the ftp server), after all of those are taken, we continue on incrementing active counter.
  

  
- GET /:target/file/down/:counter 
  Returns actual package with number passed as argument (/file/down/16)

- GET /:target//file/target/test_pro
  Returns TARGETS/TEST_PRO.pdb which is downloaded from ftp only once and after that we use cached version.
  
- GET /:target//file/target/test_ref
  Returns TARGETS/TEST_REF.sdf which is downloaded from ftp only once and after that we use cached version.
  
- POST /:target//file/:counter
  Uploads calcualted file to the ftp server. (upload with curl -F "data=@OUT_16.sdf" http://server.domain.com/file/16 )
  
- GET /current
  Returns current active counter
  
- GET /leftovers
  Returns leftovers
  
- GET /health
  Returns "ok" if server is alive and kicking


## Setup and development

### OSX

Install NodeJS (V12)
```bash
nvm install v12 && nvm use --delete-prefix v12
```
Install MongoDB (community edition)

```bash
brew tap mongodb/brew
brew install mongodb-community

# and boot it up
mongod --dbpath ./mongo-data
```

Prepare configuration file `./config.json` where `./index.js` lives with following contents
```json
{
  "path": "<current full system path> i.e. $PWD",
  "mongo": "mongodb://127.0.0.1:27017/covid"
}
```

Create missing directories

```bash
mkdir -p {mongo-data,compounds,uploads,targets}
```

Boot-up index.js
```
node index.js
```