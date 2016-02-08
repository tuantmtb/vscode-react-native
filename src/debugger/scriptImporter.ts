// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import fs = require("fs");
import {Log} from "../utils/commands/log";
import path = require("path");
import Q = require("q");
import {Request} from "../utils/node/request";
import {SourceMapUtil} from "../utils/sourceMap";
import url = require("url");

interface DownloadedScript {
    contents: string;
    filepath: string;
}

export class ScriptImporter {
    private sourcesStoragePath: string;
    private sourceMapUtil: SourceMapUtil;

    constructor(sourcesStoragePath: string) {
        this.sourcesStoragePath = sourcesStoragePath;
        this.sourceMapUtil = new SourceMapUtil();
    }

    public download(scriptUrlString: string): Q.Promise<DownloadedScript> {

        // We'll get the source code, and store it locally to have a better debugging experience
        return new Request().request(scriptUrlString, true).then(scriptBody => {
            // Extract sourceMappingURL from body
            let scriptUrl = url.parse(scriptUrlString); // scriptUrl = "http://localhost:8081/index.ios.bundle?platform=ios&dev=true"
            let sourceMappingUrl = this.sourceMapUtil.getSourceMapURL(scriptUrl, scriptBody); // sourceMappingUrl = "http://localhost:8081/index.ios.map?platform=ios&dev=true"

            let waitForSourceMapping = Q<void>(null);
            if (sourceMappingUrl) {
                /* handle source map - request it and store it locally */
                waitForSourceMapping = this.writeSourceMap(sourceMappingUrl, scriptUrl)
                    .then(() => {
                        scriptBody = this.sourceMapUtil.updateScriptPaths(scriptBody, sourceMappingUrl);
                    });
            }

            return waitForSourceMapping
                .then(() => this.writeScript(scriptBody, scriptUrl))
                .then((scriptFilePath: string) => {
                    Log.logInternalMessage(`Script ${scriptUrlString} downloaded to ${scriptFilePath}`);
                    return { contents: scriptBody, filepath: scriptFilePath };
                });
        });
    }

    /**
     * Writes the script file to the project temporary location.
     */
    private writeScript(scriptBody: string, scriptUrl: url.Url): Q.Promise<String> {
        return Q.fcall(() => {
            let scriptFilePath = path.join(this.sourcesStoragePath, scriptUrl.pathname); // scriptFilePath = "$TMPDIR/index.ios.bundle"
            this.writeTemporaryFileSync(scriptFilePath, scriptBody);
            return scriptFilePath;
        });
    }

    /**
     * Writes the source map file to the project temporary location.
     */
    private writeSourceMap(sourceMapUrl: url.Url, scriptUrl: url.Url): Q.Promise<void> {
        return new Request().request(sourceMapUrl.href, true)
            .then((sourceMapBody: string) => {
                let sourceMappingLocalPath = path.join(this.sourcesStoragePath, sourceMapUrl.pathname); // sourceMappingLocalPath = "$TMPDIR/index.ios.map"
                let scriptFileRelativePath = path.basename(scriptUrl.pathname); // scriptFileRelativePath = "index.ios.bundle"
                this.writeTemporaryFileSync(sourceMappingLocalPath, this.sourceMapUtil.updateSourceMapFile(sourceMapBody, scriptFileRelativePath, this.sourcesStoragePath));
            });
    }

    private writeTemporaryFileSync(filename: string, data: string): Q.Promise<void> {
        let writeFile = Q.nfbind<void>(fs.writeFile);

        return writeFile(filename, data)
            .then(() => this.scheduleTemporaryFileCleanUp(filename));
    }

    private scheduleTemporaryFileCleanUp(filename: string): void {
        process.on("exit", function() {
            let unlink = Q.nfbind<void>(fs.unlink);
            unlink(filename)
                .then(() => {
                    Log.logMessage("Succesfully cleaned temporary file: " + filename);
                });
        });
    }
}