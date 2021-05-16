import {promisify} from 'util';

import * as logUpdate from 'log-update';
import {MongoClient} from 'mongodb';

import {connect, pollRecipients} from '../dbutil';
import {ReshardingProgress} from '../progressmeter';

const sleep = promisify(setTimeout);

class Lifecycle {
  #started = false;
  #finished = false;

  get started() {
    return this.#started;
  }

  markStarted() {
    this.#started = true;
  }

  get finished() {
    return this.#finished;
  }

  markFinished() {
    this.#finished = true;
  }
}

async function updateMetricsContinuously(
  mongoClient: MongoClient,
  progress: ReshardingProgress,
  lifecycle: Lifecycle
) {
  while (!lifecycle.finished) {
    const shards = await pollRecipients(mongoClient);
    if (shards.length > 0) {
      lifecycle.markStarted();
      for (const shard of shards) {
        progress.addOrUpdate(shard);
      }
    } else if (lifecycle.started) {
      lifecycle.markFinished();
    }

    redrawOnce(progress);
    await sleep(1000);
  }
}

function redrawOnce(progress: ReshardingProgress) {
  logUpdate(progress.getText());
}

async function redrawContinuously(
  progress: ReshardingProgress,
  lifecycle: Lifecycle
) {
  while (!lifecycle.finished) {
    redrawOnce(progress);
    await sleep(60);
  }
}

async function run(mongoClient: MongoClient): Promise<void> {
  const progress = new ReshardingProgress();
  const lifecycle = new Lifecycle();

  await Promise.all([
    updateMetricsContinuously(mongoClient, progress, lifecycle),
    redrawContinuously(progress, lifecycle),
  ]);
}

connect(process.env.MONGODB_URI as string)
  .then(mongoClient => run(mongoClient).finally(() => mongoClient.close()))
  .catch(console.error);
