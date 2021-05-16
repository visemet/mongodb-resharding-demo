import {MongoClient, ObjectId} from 'mongodb';
import {MersenneTwister19937, Random} from 'random-js';

import {connect} from '../dbutil';

const random = new Random(MersenneTwister19937.autoSeed());

export const collName = 'orders';
export const oldShardKeyFieldName = 'order_id';
export const newShardKeyFieldName = 'customer_id';
const largeStr = 'x'.repeat(10_000); // each document is ~10KB
const numDocs = 100_000; // for a total of 1GB
const numCustomers = 10_000;
const numInitialChunks = 6;
const concurrency = 5;

async function run(mongoClient: MongoClient): Promise<void> {
  const db = mongoClient.db();
  const collection = db.collection(collName);

  console.log('Dropping collection %s', collection.namespace);
  await collection.drop();

  const oldShardKey = {[oldShardKeyFieldName]: 'hashed'};
  console.log(
    'Sharding empty collection %s on %o',
    collection.namespace,
    oldShardKey
  );
  await db.admin().command({enableSharding: db.databaseName});
  await db.admin().command({
    shardCollection: collection.namespace,
    key: oldShardKey,
    numInitialChunks,
  });

  const newShardKey = {[newShardKeyFieldName]: 'hashed'};
  await collection.createIndex(newShardKey);

  console.log(
    'Inserting data into collection %s. This may take a while...',
    collection.namespace
  );
  await Promise.all(
    Array.from({length: concurrency}, () =>
      collection.insertMany(
        Array.from({length: numDocs / concurrency}, () => ({
          [oldShardKeyFieldName]: new ObjectId(),
          [newShardKeyFieldName]: random.integer(1, numCustomers),
          counter: 0,
          padding: largeStr,
        }))
      )
    )
  );
}

if (require.main === module) {
  connect(process.env.MONGODB_URI as string)
    .then(mongoClient => run(mongoClient).finally(() => mongoClient.close()))
    .catch(console.error);
}
