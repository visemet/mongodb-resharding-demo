import formatBytes from 'bytes';

import {RecipientMetrics} from './dbutil';

function formatProgressBar(value: number, total: number, {length = 20} = {}) {
  const progress = total > 0 ? Math.trunc((value * length) / total) : 0;
  return `[${'='.repeat(progress)}${' '.repeat(length - progress)}]`;
}

class RecipientProgress {
  readonly #metrics: RecipientMetrics;

  constructor(metrics: RecipientMetrics) {
    this.#metrics = Object.assign({}, metrics);
  }

  get shardName() {
    return this.metrics.shard;
  }

  get metrics(): Readonly<RecipientMetrics> {
    return this.#metrics;
  }

  update(updatedMetrics: RecipientMetrics) {
    Object.assign(this.#metrics, updatedMetrics);
  }

  getText(indent: string): string {
    return `Shard ${this.shardName}:

${indent}Cloning initial data ... ${formatBytes(this.metrics.bytesCopied, {
      decimalPlaces: 0,
    })} cloned
${indent}Fetching oplog entries ... ${
      this.metrics.oplogEntriesFetched
    } oplog entries fetched
${indent}Applying oplog entries ...
${indent}${this.metrics.oplogEntriesApplied} / ${
      this.metrics.oplogEntriesFetched
    } oplog entries applied

`;
  }
}

export class ReshardingProgress {
  #shards: RecipientProgress[] = [];

  #totalBytesToCopy = 0;
  #totalBytesCopied = 0;
  #totalOplogEntriesFetched = 0;
  #totalOplogEntriesApplied = 0;

  addOrUpdate(updatedMetrics: RecipientMetrics) {
    let shard = this.#shards.find(
      metrics => metrics.shardName === updatedMetrics.shard
    );

    if (shard === undefined) {
      shard = new RecipientProgress(updatedMetrics);
      this.#shards.push(shard);
      this.#shards.sort((a, b) => a.shardName.localeCompare(b.shardName));
    } else {
      this.#totalBytesToCopy -= shard.metrics.approxBytesToCopy;
      this.#totalBytesCopied -= shard.metrics.bytesCopied;
      this.#totalOplogEntriesFetched -= shard.metrics.oplogEntriesFetched;
      this.#totalOplogEntriesApplied -= shard.metrics.oplogEntriesApplied;
      shard.update(updatedMetrics);
    }

    this.#totalBytesToCopy += shard.metrics.approxBytesToCopy;
    this.#totalBytesCopied += shard.metrics.bytesCopied;
    this.#totalOplogEntriesFetched += shard.metrics.oplogEntriesFetched;
    this.#totalOplogEntriesApplied += shard.metrics.oplogEntriesApplied;
  }

  getText(): string {
    let str = `Overall progress:
${formatProgressBar(
  this.#totalBytesCopied,
  this.#totalBytesToCopy
)} ${formatBytes(this.#totalBytesCopied, {
      decimalPlaces: 0,
    })} / ${formatBytes(this.#totalBytesToCopy, {decimalPlaces: 0})} cloned
${formatProgressBar(
  this.#totalOplogEntriesApplied,
  this.#totalOplogEntriesFetched
)} ${this.#totalOplogEntriesApplied} / ${
      this.#totalOplogEntriesFetched
    } oplog entries applied


`;

    for (const shard of this.#shards) {
      str += shard.getText('    ');
    }

    return str;
  }
}
