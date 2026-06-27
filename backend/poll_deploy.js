process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const run = async () => {
  const start = Date.now();
  console.log('Polling Render health check to monitor container swap...');
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('https://blde-edc-platform.onrender.com/api/health');
      if (r.status === 200) {
        const data = await r.json();
        console.log(`Checking Render... Status: ${r.status}, Deploy time: ${data.timestamp}`);
        
        // Wait at least 150 seconds (2.5 minutes) for the new container to rebuild and deploy
        if (Date.now() - start > 150000) {
          console.log('🎉 RENDER REDEPLOY COMPLETED!');
          return;
        }
      } else {
        console.log(`Checking Render... Status: ${r.status}`);
      }
    } catch (e) {
      console.log('Waiting for Render deploy... Error:', e.message);
    }
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log('Timeout waiting for Render deploy.');
};
run();
