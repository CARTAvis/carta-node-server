import * as express from "express";
import {Collection, Db, MongoClient} from "mongodb";
import {authGuard} from "./auth";
import {noCache} from "./util";
import {AuthenticatedRequest} from "./types";
import {ServerConfig} from "./config";
import * as Ajv from "ajv";

const PREFERENCE_SCHEMA_VERSION = 1;
const LAYOUT_SCHEMA_VERSION = 2;
const preferenceSchema = require("../config/preference_schema_1.json");
const layoutSchema = require("../config/layout_schema_2.json");
const ajv = new Ajv({useDefaults: true});
const validatePreferences = ajv.compile(preferenceSchema);
const validateLayout = ajv.compile(layoutSchema);

let client: MongoClient;
let preferenceCollection: Collection;
let layoutsCollection: Collection;

async function updateUsernameIndex(collection: Collection, unique: boolean) {
    const hasIndex = await collection.indexExists("username");
    if (!hasIndex) {
        await collection.createIndex({username: 1}, {name: "username", unique, dropDups: unique});
        console.log(`Created username index for collection ${collection.collectionName}`);
    }
}

async function createOrGetCollection(db: Db, collectionName: string) {
    const collectionExists = await db.listCollections({name: collectionName}, {nameOnly: true}).hasNext();
    if (collectionExists) {
        return db.collection(collectionName);
    } else {
        console.log(`Creating collection ${collectionName}`);
        return db.createCollection(collectionName);
    }
}

export async function initDB() {
    if (ServerConfig.database?.uri && ServerConfig.database?.databaseName) {
        try {
            client = await MongoClient.connect(ServerConfig.database.uri, {useUnifiedTopology: true});
            const db = await client.db(ServerConfig.database.databaseName);
            layoutsCollection = await createOrGetCollection(db, "layouts");
            preferenceCollection = await createOrGetCollection(db, "preferences");
            // Remove any existing validation in preferences collection
            await db.command({collMod: "preferences", validator: {}, validationLevel: "off"});
            // Update collection indices if necessary
            await updateUsernameIndex(layoutsCollection, false);
            await updateUsernameIndex(preferenceCollection, true);
            console.log(`Connected to server ${ServerConfig.database.uri} and database ${ServerConfig.database.databaseName}`);
        } catch (err) {
            console.log(err);
            console.error("Error connecting to database");
            process.exit(1);
        }
    } else {
        console.error("Database configuration not found");
        process.exit(1);
    }
}

async function handleGetPreferences(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!preferenceCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const doc = await preferenceCollection.findOne({username: req.username}, {projection: {_id: 0, username: 0}});
        if (doc) {
            res.json({success: true, preferences: doc});
        } else {
            return next({statusCode: 500, message: "Problem retrieving preferences"});
        }
    } catch (err) {
        console.log(err);
        return next({statusCode: 500, message: "Problem retrieving preferences"});
    }
}

async function handleSetPreferences(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!preferenceCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const update = req.body;
    // Check for malformed update
    if (!update || !Object.keys(update).length || update.username || update._id) {
        return next({statusCode: 400, message: "Malformed preference update"});
    }

    update.version = PREFERENCE_SCHEMA_VERSION;

    const validUpdate = validatePreferences(update);
    if (!validUpdate) {
        console.log(validatePreferences.errors);
        return next({statusCode: 400, message: "Malformed preference update"});
    }

    try {
        const updateResult = await preferenceCollection.updateOne({username: req.username}, {$set: update}, {upsert: true});
        if (updateResult.result?.ok) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating preferences"});
        }
    } catch (err) {
        console.log(err.errmsg);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearPreferences(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!preferenceCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const keys: string[] = req.body?.keys;
    // Check for malformed update
    if (!keys || !Array.isArray(keys) || !keys.length) {
        return next({statusCode: 400, message: "Malformed key list"});
    }

    const update: any = {};
    for (const key of keys) {
        update[key] = "";
    }

    try {
        const updateResult = await preferenceCollection.updateOne({username: req.username}, {$unset: update});
        if (updateResult.result?.ok) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing preferences"});
        }
    } catch (err) {
        console.log(err);
        return next({statusCode: 500, message: "Problem clearing preferences"});
    }
}

async function handleGetLayouts(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const layoutList = await layoutsCollection.find({username: req.username}, {projection: {_id: 0, username: 0}}).toArray();
        const layouts = {} as any;
        for (const entry of layoutList) {
            if (entry.name && entry.layout) {
                layouts[entry.name] = entry.layout;
            }
        }
        res.json({success: true, layouts});
    } catch (err) {
        console.log(err);
        return next({statusCode: 500, message: "Problem retrieving layouts"});
    }
}

async function handleSetLayout(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const layoutName = req.body?.layoutName;
    const layout = req.body?.layout;
    // Check for malformed update
    if (!layoutName || !layout || layout.layoutVersion !== LAYOUT_SCHEMA_VERSION) {
        return next({statusCode: 400, message: "Malformed layout update"});
    }

    const validUpdate = validateLayout(layout);
    if (!validUpdate) {
        console.log(validateLayout.errors);
        return next({statusCode: 400, message: "Malformed layout update"});
    }

    try {
        const updateResult = await layoutsCollection.updateOne({username: req.username, name: layoutName, layout}, {$set: {layout}}, {upsert: true});
        if (updateResult.result?.ok) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating layout"});
        }
    } catch (err) {
        console.log(err.errmsg);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearLayout(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const layoutName = req.body?.layoutName;
    try {
        const deleteResult = await layoutsCollection.deleteOne({username: req.username, name: layoutName});
        if (deleteResult.result?.ok) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing layout"});
        }
    } catch (err) {
        console.log(err);
        return next({statusCode: 500, message: "Problem clearing layout"});
    }
}

export const databaseRouter = express.Router();

databaseRouter.get("/preferences", authGuard, noCache, handleGetPreferences);
databaseRouter.put("/preferences", authGuard, noCache, handleSetPreferences);
databaseRouter.delete("/preferences", authGuard, noCache, handleClearPreferences);

databaseRouter.get("/layouts", authGuard, noCache, handleGetLayouts);
databaseRouter.put("/layout", authGuard, noCache, handleSetLayout);
databaseRouter.delete("/layout", authGuard, noCache, handleClearLayout);
