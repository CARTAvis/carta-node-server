import * as express from "express";
import {Collection, MongoClient} from "mongodb";
import {AuthenticatedRequest, authGuard} from "./auth";
import {noCache} from "./util";

const PREFERENCE_SCHEMA_VERSION = 1;
const preferenceSchema = require("./preference_schema_1.json");
const config = require("../config/config.ts");

let client: MongoClient;
let preferenceCollection: Collection;

export async function initDB() {
    if (config.database?.url && config.database?.databaseName) {
        try {
            client = await MongoClient.connect(config.database.url, {useUnifiedTopology: true});
            const db = await client.db(config.database.databaseName);
            // Create collection if it doesn't exist
            preferenceCollection = await db.createCollection("preferences");
            // Update with the latest schema
            await db.command({collMod: "preferences", validator: {$jsonSchema: preferenceSchema}});
            const hasIndex = await preferenceCollection.indexExists("username");
            if (!hasIndex) {
                await preferenceCollection.createIndex({username: 1}, {name: "username", unique: true, dropDups: true});
                console.log(`Created username index for collection ${preferenceCollection.collectionName}`);
            }
            console.log(`Connected to server ${config.database.url} and database ${config.database.databaseName}`);
        } catch (err) {
            console.log(err);
            console.error("Error connecting to database");
        }
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

export const databaseRouter = express.Router();

databaseRouter.get("/preferences", authGuard, noCache, handleGetPreferences);
databaseRouter.delete("/preferences", authGuard, noCache, handleClearPreferences);
databaseRouter.put("/preferences", authGuard, noCache, handleSetPreferences);