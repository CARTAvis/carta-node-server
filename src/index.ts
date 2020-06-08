import * as express from "express";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as httpProxy from "http-proxy";
import * as http from "http";
import {createUpgradeHandler, serverRoutes} from "./serverHandlers";
import {authRoutes} from "./auth";

let app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'))

app.use("/api/auth", authRoutes);
app.use("/api/server", serverRoutes)

const expressServer = http.createServer(app);
const backendProxy = httpProxy.createServer({ws: true});

// Handle WS connections
expressServer.on("upgrade", createUpgradeHandler(backendProxy));

const config = require("../config/config.ts");
expressServer.listen(config.serverPort, () => console.log(`Started listening for login requests on port ${config.serverPort}`));