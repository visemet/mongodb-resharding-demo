import faker from 'faker/locale/en_US';
import {
  Collection,
  Decimal128,
  MongoClient,
  ObjectId,
  OptionalId,
} from 'mongodb';
import orderId from 'order-id';
import {MersenneTwister19937, Random} from 'random-js';

import {connect} from '../dbutil';

const random = new Random(MersenneTwister19937.autoSeed());
const orderIdGenerator = orderId('mongodb-resharding-demo');

export const collName = 'orders';
export const orderIdFieldName = 'order_id';
export const customerIdFieldName = 'customer_id';
const largeStr = 'x'.repeat(10_000); // each document is ~10KB
const numOrders = 200_000; // for a total of ~2GB
const numCustomers = 10_000;
const numInitialChunks = 6;
const batchSize = 1500;
const concurrency = 5;
const now = new Date();
const recent = (() => {
  const x = new Date(now);
  x.setDate(x.getDate() - 30);
  return x;
})();

async function ensureCollectionDropped(collection: Collection) {
  const kNamespaceNotFound = 26;
  try {
    await collection.drop();
  } catch (err) {
    if (err.code !== kNamespaceNotFound) {
      throw err;
    }
  }
}

function makeOrderId() {
  return orderIdGenerator.generate(random.date(recent, now));
}

function makePrice() {
  const kCents = 100;
  const amount = random.integer(1 * kCents, 100 * kCents);
  return (amount / kCents).toFixed(2);
}

function makeOrder() {
  return {
    _id: new ObjectId(),
    [orderIdFieldName]: makeOrderId(),
    [customerIdFieldName]: random.integer(1, numCustomers),
    counter: 0,
    shipping_address: {
      name: faker.name.findName(),
      street: faker.address.streetAddress(true),
      city: faker.address.cityName(),
      state: faker.address.stateAbbr(),
    },
    order: Array.from({length: random.integer(1, 5)}, () => ({
      product: faker.commerce.productName(),
      qty: random.integer(1, 3),
      price: Decimal128.fromString(makePrice()),
    })),
    padding: largeStr,
  };
}

function* insertOrderBatchGenerator() {
  let remainingOrders = numOrders;
  while (remainingOrders > 0) {
    const insertBatchSize = Math.min(batchSize, remainingOrders);
    yield Array.from({length: insertBatchSize}, () => makeOrder());
    remainingOrders -= insertBatchSize;
  }
}

async function insertOrders<T>(
  collection: Collection<T>,
  gen: Generator<OptionalId<T>[]>
) {
  for (const orders of gen) {
    await collection.insertMany(orders);
  }
}

async function run(mongoClient: MongoClient): Promise<void> {
  const db = mongoClient.db();
  const collection = db.collection(collName);

  console.log('Dropping collection %s', collection.namespace);
  await ensureCollectionDropped(collection);

  const oldShardKey = {[orderIdFieldName]: 'hashed'};
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

  console.log(
    'Inserting data into collection %s. This may take a while...',
    collection.namespace
  );
  const gen = insertOrderBatchGenerator();
  await Promise.all(
    Array.from({length: concurrency}, () =>
      Promise.resolve().then(() => insertOrders(collection, gen))
    )
  );
}

if (require.main === module) {
  faker.seed(random.uint53());

  connect(process.env.MONGODB_URI!)
    .then(mongoClient => run(mongoClient).finally(() => mongoClient.close()))
    .catch(console.error);
}
