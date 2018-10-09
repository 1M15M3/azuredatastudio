/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as path from 'path';
import { IConfig, ServerProvider } from 'service-downloader';
import { SqlOpsDataClient, SqlOpsFeature, ClientOptions } from 'dataprotocol-client';
import { ServerCapabilities, ClientCapabilities, RPCMessageType, ServerOptions, TransportKind } from 'vscode-languageclient';
import * as UUID from 'vscode-languageclient/lib/utils/uuid';

import * as sqlops from 'sqlops';
import { Disposable, workspace } from 'vscode';

import { CreateFirewallRuleRequest, HandleFirewallRuleRequest, CreateFirewallRuleParams, HandleFirewallRuleParams } from './contracts';
import * as Constants from './constants';
import * as Utils from '../utils';
const findRemoveSync = require('find-remove');

class FireWallFeature extends SqlOpsFeature<any> {

	private static readonly messagesTypes: RPCMessageType[] = [
		CreateFirewallRuleRequest.type,
		HandleFirewallRuleRequest.type
	];

	constructor(client: SqlOpsDataClient) {
		super(client, FireWallFeature.messagesTypes);
	}

	fillClientCapabilities(capabilities: ClientCapabilities): void {
		Utils.ensure(Utils.ensure(capabilities, 'firewall')!, 'firwall')!.dynamicRegistration = true;
	}

	initialize(capabilities: ServerCapabilities): void {
		this.register(this.messages, {
			id: UUID.generateUuid(),
			registerOptions: undefined
		});
	}

	protected registerProvider(options: any): Disposable {
		const client = this._client;

		let createFirewallRule = (account: sqlops.Account, firewallruleInfo: sqlops.FirewallRuleInfo): Thenable<sqlops.CreateFirewallRuleResponse> => {
			return client.sendRequest(CreateFirewallRuleRequest.type, asCreateFirewallRuleParams(account, firewallruleInfo));
		};

		let handleFirewallRule = (errorCode: number, errorMessage: string, connectionTypeId: string): Thenable<sqlops.HandleFirewallRuleResponse> => {
			let params: HandleFirewallRuleParams = { errorCode: errorCode, errorMessage: errorMessage, connectionTypeId: connectionTypeId };
			return client.sendRequest(HandleFirewallRuleRequest.type, params);
		};

		return sqlops.resources.registerResourceProvider({
			displayName: 'Azure SQL Resource Provider', // TODO Localize
			id: 'Microsoft.Azure.SQL.ResourceProvider',
			settings: {

			}
		}, {
				handleFirewallRule,
				createFirewallRule
			});
	}
}

function asCreateFirewallRuleParams(account: sqlops.Account, params: sqlops.FirewallRuleInfo): CreateFirewallRuleParams {
	return {
		account: account,
		serverName: params.serverName,
		startIpAddress: params.startIpAddress,
		endIpAddress: params.endIpAddress,
		securityTokenMappings: params.securityTokenMappings
	};
}

export class AzureResourceProvider {
	private _client: SqlOpsDataClient;
	private _config: IConfig;

	constructor(baseConfig: IConfig) {
		if (baseConfig) {
			this._config = JSON.parse(JSON.stringify(baseConfig));
			this._config.executableFiles = ['SqlToolsResourceProviderService.exe', 'SqlToolsResourceProviderService'];
		}
	}

	public start() {
		let serverdownloader = new ServerProvider(this._config);
		let clientOptions: ClientOptions = {
			providerId: Constants.providerId,
			features: [FireWallFeature]
		};
		serverdownloader.getOrDownloadServer().then(e => {
			let serverOptions = this.generateServerOptions(e);
			this._client = new SqlOpsDataClient(Constants.serviceName, serverOptions, clientOptions);
			this._client.start();
		});
	}

	public dispose() {
		if (this._client) {
			this._client.stop();
		}
	}

	private generateServerOptions(executablePath: string): ServerOptions {
		let launchArgs = [];
		launchArgs.push('--log-file');
		let logFile = path.join(Utils.getDefaultLogLocation(), 'mssql', `resourceprovider_${process.pid}.log`);
		launchArgs.push(logFile);
		console.log(`logFile for ${path.basename(executablePath)} is ${logFile}`);
		console.log(`This process (ui Extenstion Host) is pid: ${process.pid}`);
		//Delete log files older than a week
		let deletedLogFiles = findRemoveSync(path.join(Utils.getDefaultLogLocation(), 'mssql'), {extensions: '.log', age: {seconds: 604800}, limit: 100, prefix: 'resourceprovider_'});
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
