process.env.JWT_SECRET = 'blde_secret_test_key_2026_change_me';
import db from '../src/db/connection.js';

const seedConsultants = async () => {
  try {
    console.log('🌱 Seeding default consultants for Research Assistant platform...');
    
    // Clear any existing consultants to prevent duplicates
    await db('consultants').del();

    const consultants = [
      { name: 'Dr. Sharan Patil', email: 'patil.sharan@blde.ac.in', role: 'consultant', active: true },
      { name: 'Prof. Anita G.', email: 'anita.g@blde.ac.in', role: 'statistician', active: true },
      { name: 'Dr. Suresh K.', email: 'suresh.k@blde.ac.in', role: 'ai_engineer', active: true },
      { name: 'Amit Kumar', email: 'kumar.amit@blde.ac.in', role: 'db_operator', active: true },
      { name: 'Vani K.', email: 'vani.k@blde.ac.in', role: 'qa', active: true }
    ];

    await db('consultants').insert(consultants);
    console.log('✅ Default consultants successfully seeded into the database.');
  } catch (error) {
    console.error('❌ Failed to seed consultants: ', error);
  } finally {
    await db.destroy();
  }
};

seedConsultants();
