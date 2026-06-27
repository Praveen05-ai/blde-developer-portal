import db from './src/db/connection.js';

async function run() {
  try {
    const fields = [
      {
        id: 'ht_sbp',
        label: 'Systolic BP (mmHg)',
        type: 'number',
        required: true,
        validation: {
          type: 'range',
          min: 80,
          max: 220,
          message: 'maximum limit is 220'
        }
      },
      {
        id: 'ht_dbp',
        label: 'Diastolic BP (mmHg)',
        type: 'number',
        required: true,
        validation: {
          type: 'range',
          min: 50,
          max: 120,
          message: 'minimum limit is 50'
        }
      }
    ];

    const result = await db('instruments')
      .where({ id: 8 })
      .update({
        fields: JSON.stringify(fields)
      });

    console.log('Update result:', result);

    const updated = await db('instruments').where({ id: 8 }).first();
    console.log('UPDATED INSTRUMENT:', updated);
  } catch (err) {
    console.error('Error fixing instrument fields:', err);
  } finally {
    await db.destroy();
  }
}

run();
