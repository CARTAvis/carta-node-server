import * as yargs from "yargs";
import {CartaCommandLineOptions, CartaServerConfig} from "./types";
import * as Ajv from "ajv";

const argv = yargs.options({
    config: {
        type: "string",
        default: "/etc/carta/config.json",
        alias: "c",
        description: "Path to config file in JSON format"
    }
}).argv as CartaCommandLineOptions;

const configSchema = require("../config/config_schema.json");
const ajv = new Ajv({useDefaults: true});
const validateConfig = ajv.compile(configSchema);

let configObject: CartaServerConfig;

try {
    console.log(`Checking config file ${argv.config}`);
    configObject = require(argv.config);
    const isValid = validateConfig(configObject);
    if (!isValid) {
        console.error(validateConfig.errors);
        process.exit(1);
    }
} catch (err) {
    console.log(err);
    process.exit(1);
}

export default configObject;