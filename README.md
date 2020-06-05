# covid-solver-queue
## API handlers
**Every POST request checks for API key**
Pass API key with `curl -X POST -d "apikey=\<apikey>" https://server.domain.com/<handler>`

- POST /target
  Returns target to wich should be all the following requests sent
  `curl -X POST -d "apikey=\<apikey>" https://server.domain.com/target`
  
- POST /:target/counter 
  Returns current package number that should be calculated. First we empty the leftover list (filled every two hours with lookup to the specified directory), after all of those are taken, we continue on incrementing active counter.
  `curl -X POST -d "apikey=\<apikey>" https://server.domain.com/1/counter`
  
- POST /:target/file/down/:counter 
  Returns actual package with number passed as argument
  `curl -X POST -d "apikey=\<apikey>" https://server.domain.com/1/file/down/16`

- POST /:target/file/target/archive
  Returns :target/targets/archive.zip
  `curl -X POST -d "apikey=\<apikey>" https://server.domain.com/`
  
- POST /:target/file/:counter
  Uploads calcualted file to the ftp server.
  Can also handle statistical data
  `curl -X POST -F "data=@OUT_16.sdf" -F "apikey=\<apikey>" -F "Client=covid-solver-unix" -F "ClientGUID=\<random GUID>" -F "ThreadCount=3" https://server.domain.com/1/file/16`
  
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

Install dependencies
```bash
yarn install
# or
npm install
```

Boot-up index.js
```
node index.js
```
