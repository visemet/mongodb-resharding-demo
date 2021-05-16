import {AggregationCursor, Db, MongoClient} from 'mongodb';

export async function connect(uri: string): Promise<MongoClient> {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  await client.connect();
  return client;
}

export type RecipientMetrics = {
  shard: string;
  approxBytesToCopy: number;
  bytesCopied: number;
  oplogEntriesFetched: number;
  oplogEntriesApplied: number;
};

const projection: {[K in keyof RecipientMetrics]: 1} = {
  shard: 1,
  approxBytesToCopy: 1,
  bytesCopied: 1,
  oplogEntriesFetched: 1,
  oplogEntriesApplied: 1,
};

interface DbWithAggregate<T> extends Db {
  aggregate(pipeline: object[]): AggregationCursor<T>;
}

export async function pollRecipients(
  mongoClient: MongoClient
): Promise<RecipientMetrics[]> {
  const db = mongoClient.db('admin') as DbWithAggregate<RecipientMetrics>;
  const cursor = db.aggregate([
    {$currentOp: {localOps: false}},
    {
      $match: {
        type: 'op',
        'originatingCommand.reshardCollection': {$exists: true},
        recipientState: {$exists: true},
      },
    },
    {$sort: {shard: 1}},
    {
      $project: projection,
    },
  ]);

  return cursor.toArray();
}
