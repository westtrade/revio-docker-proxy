require('dotenv-extended').load()
const { Server } = require('revio')
const Docker = require('dockerode')
const bole = require('bole')
const diff = require('deep-diff')

const log = bole('westtrade-proxy')
bole.output([
	{
		level: 'info',
		stream: process.stdout,
	},
])

const dockerClient = new Docker({
	socketPath: process.env.DOCKER_SOCKET_PATH,
})

const server = new Server({
	port: process.env.HTTP_PORT,
})

server.logger = log

// server.register('localhost', 'http://172.22.0.2/')

async function info(Id) {
	return dockerClient.getContainer(Id).inspect()
}

const envy = (result = {}, row) => {
	const [key, value] = row.split('=')
	result[key] = value
	return result
}

async function containers() {
	return dockerClient
		.listContainers()
		.then(containers => {
			const containersInfo = containers.map(({ Id }) => info(Id))
			return Promise.all(containersInfo)
		})
		.then(containers =>
			containers
				.map(container => {
					container.Config.Env = container.Config.Env.reduce(envy, {})
					return container
				})
				.filter(({ Config: { Env } }) => 'VIRTUAL_HOST' in Env),
		)
}

function makeHosts(containersList = []) {
	return containersList.reduce((hosts, info) => {
		const {
			NetworkSettings,
			NetworkSettings: { Networks },
			Config: { Env },
		} = info

		const { VIRTUAL_HOST, VIRTUAL_PORT = 80, VIRTUAL_HTTPS = null } = Env

		const ips = Object.values(Networks).map(
			({ IPAddress }) => `http://${IPAddress}:${VIRTUAL_PORT || 80}/`,
		)

		if (!ips.length) {
			return hosts
		}

		if (!hosts[VIRTUAL_HOST]) {
			hosts[VIRTUAL_HOST] = {
				upstream: [],
				https: VIRTUAL_HTTPS,
			}
		}

		hosts[VIRTUAL_HOST].upstream.push(ips[0])

		return hosts
	}, {})
}

function bindHosts(initialHosts, currentHosts) {
	;(diff(initialHosts, currentHosts) || []).forEach(
		({ kind, path: [host] }) => {
			if (kind === 'N') {
				console.log(host)
				const { upstream = [] } = currentHosts[host]
				upstream.forEach(upstream => {
					server.register(host, upstream)
				})
			}

			if (kind === 'D') {
				server.unregister(host)
			}

			if (kind === 'E' || kind === 'A') {
				const { upstream = [] } = currentHosts[host]
				server.unregister(host)
				upstream.forEach(upstream => {
					server.register(host, upstream)
				})
			}
		},
	)

	return currentHosts
}

async function main() {
	const eventsStream = await dockerClient.getEvents()
	const initialContainersList = await containers()
	let hosts = bindHosts({}, makeHosts(initialContainersList))

	eventsStream.on('data', async _ => {
		const { status, Actor: { Attributes: { name } } } = JSON.parse(
			_.toString('utf-8'),
		)

		if (!['start', 'stop'].includes(status)) {
			return
		}

		const containersList = await containers()
		hosts = bindHosts(hosts, makeHosts(containersList))
	})
}

main()
