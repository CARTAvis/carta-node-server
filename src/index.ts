import * as express from "express";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as httpProxy from "http-proxy";
import * as http from "http";
import * as chalk from "chalk";
import {createUpgradeHandler, serverRouter} from "./serverHandlers";
import {authRouter} from "./auth";
import {databaseRouter, initDB} from "./database";

let app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'))

app.use("/api/auth", authRouter);
app.use("/api/server", serverRouter);
app.use("/api/database", databaseRouter);

const expressServer = http.createServer(app);
const backendProxy = httpProxy.createServer({ws: true});

// Handle WS connections
expressServer.on("upgrade", createUpgradeHandler(backendProxy));
const config = require("../config/config.ts");

async function init() {
    await initDB();
    expressServer.listen(config.serverPort, () => console.log(`Started listening for login requests on port ${config.serverPort}`));
}

init().then(() => console.log(chalk.green.bold("Server initialised successfully")));