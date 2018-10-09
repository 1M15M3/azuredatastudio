/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { SqlOpsDataClient, ClientOptions, SqlOpsFeature } from 'dataprotocol-client';
import * as path from 'path';
import { IConfig, ServerProvider } from 'service-downloader';
import { ServerOptions, RPCMessageType, ClientCapabilities, ServerCapabilities, TransportKind } from 'vscode-languageclient';
import { Disposable, workspace } from 'vscode';
import * as UUID from 'vscode-languageclient/lib/utils/uuid';
import * as sqlops from 'sqlops';

import * as Contracts from './contracts';
import * as Constants from './constants';
import * as Utils from '../utils';
const findRemoveSync = require('find-remove');

class CredentialsFeature extends SqlOpsFeature<any> {

	private static readonly messagesTypes: RPCMessageType[] = [
		Contracts.DeleteCredentialRequest.type,
		Contracts.SaveCredentialRequest.type,
		Contracts.ReadCredentialRequest.type
	];

	constructor(client: SqlOpsDataClient) {
		super(client, CredentialsFeature.messagesTypes);
	}

	fillClientCapabilities(capabilities: ClientCapabilities): void {
		Utils.ensure(Utils.ensure(capabilities, 'credentials')!, 'credentials')!.dynamicRegistration = true;
	}

	initialize(capabilities: ServerCapabilities): void {
		this.register(this.messages, {
			id: UUID.generateUuid(),
			registerOptions: undefined
		});
	}

	protected registerProvider(options: any): Disposable {
		const client = this._client;

		let readCredential = (credentialId: string): Thenable<sqlops.Credential> => {
			return client.sendRequest(Contracts.ReadCredentialRequest.type, { credentialId });
		};

		let saveCredential = (credentialId: string, password: string): Thenable<boolean> => {
			return client.sendRequest(Contracts.SaveCredentialRequest.type, { credentialId, password });
		};

		let deleteCredential = (credentialId: string): Thenable<boolean> => {
			return client.sendRequest(Contracts.DeleteCredentialRequest.type, { credentialId });
		};

		return sqlops.credentials.registerProvider({
			deleteCredential,
			readCredential,
			saveCredential,
			handle: 0
		});
	}
}

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 *
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore {
	private _client: SqlOpsDataClient;
	private _config: IConfig;

	constructor(baseConfig: IConfig) {
		if (baseConfig) {
			this._config = JSON.parse(JSON.stringify(baseConfig));
			this._config.executableFiles = ['MicrosoftSqlToolsCredentials.exe', 'MicrosoftSqlToolsCredentials'];
		}
	}

	public start() {
		let serverdownloader = new ServerProvider(this._config);
		let clientOptions: ClientOptions = {
			providerId: Constants.providerId,
			features: [CredentialsFeature]
		};
		serverdownloader.getOrDownloadServer().then(e => {
			let serverOptions = this.generateServerOptions(e);
			this._client = new SqlOpsDataClient(Constants.serviceName, serverOptions, clientOptions);
			this._client.start();
		});
	}

	dispose() {
		if (this._client) {
			this._client.stop();
		}
	}

	private generateServerOptions(executablePath: string): ServerOptions {
		let launchArgs = [];
		launchArgs.push('--log-file');
		let logFile = path.join(Utils.getDefaultLogLocation(), 'mssql', `credentialstore_${process.pid}.log`);
		launchArgs.push(logFile);
		console.log(`logFile for ${path.basename(executablePath)} is ${logFile}`);
		//Delete log files older than a week
		let deletedLogFiles = findRemoveSync(path.join(Utils.getDefaultLogLocation(), 'mssql'), {extensions: '.log', age: {seconds: 604800}, limit: 100, prefix: 'credentialstore_'});
		console.log(`Old log files Deletetion Report: ${JSON.stringify(deletedLogFiles)}`);
		let config = workspace.getConfiguration(Constants.extensionConfigSectionName);
		if (config) {
			let configTracingLevel = config[Constants.configTracingLevel];
			launchArgs.push('--tracing-level');
			launchArgs.push(configTracingLevel);
		}

		return { command: executablePath, args: launchArgs, transport: TransportKind.stdio };
	}
}
