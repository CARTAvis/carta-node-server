import * as express from 'express';
import * as bodyParser from "body-parser";
import * as bearerToken from "express-bearer-token"
import * as cookieParser from "cookie-parser";
import * as httpProxy from "http-proxy";
import * as http from "http";
import * as url from "url";
import * as cors from "cors";
import * as fs from "fs";
import * as path from "path";
import * as compression from "compression";
import * as chalk from "chalk";
import {createUpgradeHandler, serverRouter} from "./serverHandlers";
import {authRouter} from "./auth";
import {databaseRouter, initDB} from "./database";
import {ServerConfig, RuntimeConfig} from "./config";

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

app.use("/config", (req: express.Request, res: express.Response) => {
    return res.json(RuntimeConfig);
});

if (ServerConfig.frontendPath) {
    console.log(chalk.green.bold(`Serving CARTA frontend from ${ServerConfig.frontendPath}`));
    app.use("/", express.static(ServerConfig.frontendPath));
} else {
    const frontendPackage = require("../node_modules/carta-frontend/package.json");
    const frontendVersion = frontendPackage?.version;
    console.log(chalk.green.bold(`Serving packaged CARTA frontend (Version ${frontendVersion})`));
    app.use("/", express.static(path.join(__dirname, "../node_modules/carta-frontend/build")));
}

let bannerDataUri: string;
if (ServerConfig.dashboard?.bannerImage) {
    const isBannerSvg = ServerConfig.dashboard.bannerImage.toLowerCase().endsWith(".svg");
    const bannerDataBase64 = fs.readFileSync(ServerConfig.dashboard.bannerImage, 'base64');
    if (isBannerSvg) {
        bannerDataUri = "data:image/svg+xml;base64," + bannerDataBase64;
    } else {
        bannerDataUri = "data:image/png;base64," + bannerDataBase64;
    }
}

app.get("/frontend", (req, res) => {
    const queryString = url.parse(req.url, false)?.query;
    if (queryString) {
        return res.redirect(ServerConfig.serverAddress + "/?" + queryString);
    } else {
        return res.redirect(ServerConfig.serverAddress);
    }
});

app.get("/dashboard", function (req, res) {
    res.render("templated", {
        clientId: ServerConfig.authProviders.google?.clientId,
        hostedDomain: ServerConfig.authProviders.google?.validDomain,
        bannerColor: ServerConfig.dashboard?.bannerColor,
        backgroundColor: ServerConfig.dashboard?.backgroundColor,
        bannerImage: bannerDataUri,
        infoText: ServerConfig.dashboard?.infoText,
        loginText: ServerConfig.dashboard?.loginText,
        footerText: ServerConfig.dashboard?.footerText
    });
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