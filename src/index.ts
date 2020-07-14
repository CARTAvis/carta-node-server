import * as express from 'express';
import * as bodyParser from "body-parser";
import * as bearerToken from "express-bearer-token"
import * as cookieParser from "cookie-parser";
import * as httpProxy from "http-proxy";
import * as http from "http";
import * as cors from "cors";
import * as compression from "compression";
import * as chalk from "chalk";
import {createUpgradeHandler, serverRouter} from "./serverHandlers";
import {authRouter} from "./auth";
import {databaseRouter, initDB} from "./database";

let app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(bearerToken());
app.use(cors());
app.use(compression());

app.use("/api/auth", authRouter);
app.use("/api/server", serverRouter);
app.use("/api/database", databaseRouter);

const config = require("../config/config.ts");

// Construct runtime config
type RuntimeConfig = {
    dashboardAddress?: string;
    apiAddress?: string;
    googleClientId?: string;
    tokenRefreshAddress?: string;
    logoutAddress?: string;
}
const runtimeConfig: RuntimeConfig = {};

runtimeConfig.dashboardAddress = config.dashboardAddress || config.serverAddress;
runtimeConfig.apiAddress = config.apiAddress || (config.serverAddress + "/api");
if (config.authProviders.google) {
    runtimeConfig.googleClientId = config.authProviders.google.clientId;
} else if (config.authProviders.external) {
    runtimeConfig.tokenRefreshAddress = config.authProviders.external.tokenRefreshAddress;
    runtimeConfig.logoutAddress = config.authProviders.external.logoutAddress;
} else {
    runtimeConfig.tokenRefreshAddress = runtimeConfig.apiAddress + "/auth/refresh";
    runtimeConfig.logoutAddress = runtimeConfig.apiAddress + "/auth/logout";
}

app.use("/frontend/config", (req: express.Request, res: express.Response) => {
    return res.json(runtimeConfig);
})

app.use(express.static('public'));


// Simplified error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    res.status(err.statusCode).json({
        status: err.status,
        message: err.message
    });
});

const expressServer = http.createServer(app);
const backendProxy = httpProxy.createServer({ws: true});

// Handle WS connections
expressServer.on("upgrade", createUpgradeHandler(backendProxy));

// Handle WS disconnects
backendProxy.on("error", (err: any) => {
    // Ignore connection resets
    if (err?.code === "ECONNRESET") {
        return;
    } else {
        console.log("Proxy error:");
        console.log(err);
    }
});


async function init() {
    await initDB();
    expressServer.listen(config.serverPort, () => console.log(`Started listening for login requests on port ${config.serverPort}`));
}

init().then(() => console.log(chalk.green.bold("Server initialised successfully")));