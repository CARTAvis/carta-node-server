import * as express from 'express';
import * as bodyParser from "body-parser";
import * as bearerToken from "express-bearer-token"
import * as cookieParser from "cookie-parser";
import * as httpProxy from "http-proxy";
import * as http from "http";
import * as cors from "cors";
import * as path from "path";
import * as compression from "compression";
import * as chalk from "chalk";
import {createUpgradeHandler, serverRouter} from "./serverHandlers";
import {authRouter} from "./auth";
import {databaseRouter, initDB} from "./database";
import {CartaRuntimeConfig} from "./types";
import ServerConfig from "./config";

let app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(bearerToken());
app.use(cors());
app.use(compression());
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "../views"));
app.use("/api/auth", authRouter);
app.use("/api/server", serverRouter);
app.use("/api/database", databaseRouter);

// Construct runtime config
const runtimeConfig: CartaRuntimeConfig = {};

runtimeConfig.dashboardAddress = ServerConfig.dashboardAddress || (ServerConfig.serverAddress + "/dashboard");
runtimeConfig.apiAddress = ServerConfig.apiAddress || (ServerConfig.serverAddress + "/api");
if (ServerConfig.authProviders.google) {
    runtimeConfig.googleClientId = ServerConfig.authProviders.google.clientId;
} else if (ServerConfig.authProviders.external) {
    runtimeConfig.tokenRefreshAddress = ServerConfig.authProviders.external.tokenRefreshAddress;
    runtimeConfig.logoutAddress = ServerConfig.authProviders.external.logoutAddress;
} else {
    runtimeConfig.tokenRefreshAddress = runtimeConfig.apiAddress + "/auth/refresh";
    runtimeConfig.logoutAddress = runtimeConfig.apiAddress + "/auth/logout";
}

app.use("/config", (req: express.Request, res: express.Response) => {
    return res.json(runtimeConfig);
});

if (ServerConfig.frontendPath) {
    console.log(chalk.green.bold(`Serving CARTA frontend from ${ServerConfig.frontendPath}`));
    app.use("/", express.static(ServerConfig.frontendPath));
    app.use("/frontend", express.static(ServerConfig.frontendPath));
} else {
    const frontendPackage = require("../node_modules/carta-frontend/package.json");
    const frontendVersion = frontendPackage?.version;
    console.log(chalk.green.bold(`Serving packaged CARTA frontend (Version ${frontendVersion})`));
    app.use("/", express.static(path.join(__dirname, "../node_modules/carta-frontend/build")));
}

app.get("/dashboard", function (req, res) {
    res.render("index", {clientId: ServerConfig.authProviders.google?.clientId, hostedDomain: ServerConfig.authProviders.google?.validDomain});
});

app.use("/dashboard", express.static(path.join(__dirname, "../public")));

// Simplified error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

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
    expressServer.listen(ServerConfig.serverPort, () => console.log(`Started listening for login requests on port ${ServerConfig.serverPort}`));
}

init().then(() => console.log(chalk.green.bold(`Server initialised successfully at ${ServerConfig.serverAddress}`)));