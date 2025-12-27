const delay = Math.floor(Math.random() * 1000) + 200;
console.log(`Testing @complex/utils... (simulated ${delay}ms)`);
await new Promise((resolve) => setTimeout(resolve, delay));
console.log(`Tested @complex/utils`);
