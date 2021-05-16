import {MongoClient, ObjectId} from 'mongodb';

import {connect} from '../dbutil';
import {collName, newShardKeyFieldName, oldShardKeyFieldName} from './populate';

const numUpdates = 100_000;
const sampleSize = 100;
const concurrency = 1;

const projection = {
  _id: 1,
  [oldShardKeyFieldName]: 1,
  [newShardKeyFieldName]: 1,
};

async function run(mongoClient: MongoClient): Promise<void> {
  const db = mongoClient.db();
  const collection = db.collection<{_id: ObjectId; counter: number}>(collName);

  await Promise.all(
    Array.from({length: concurrency}, () => {
      let promise = Promise.resolve();

      for (let i = 0; i < numUpdates; ++i) {
        promise = promise.then(() =>
          collection
            .aggregate([{$sample: {size: sampleSize}}, {$project: projection}])
            .toArray()
            .then(docs =>
              collection.bulkWrite(
                docs.map(filter => ({
                  updateOne: {
                    filter,
                    update: {$inc: {counter: 1}},
                  },
                }))
              )
            )
            .then(() => {})
        );
      }

      return promise;
    })
  );
}

connect(process.env.MONGODB_URI as string)
  .then(mongoClient => run(mongoClient).finally(() => mongoClient.close()))
  .catch(console.error);
