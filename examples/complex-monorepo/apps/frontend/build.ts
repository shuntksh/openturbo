const delay = Math.floor(Math.random() * 2500) + 500;
console.log(`Building @complex/frontend... (simulated ${delay}ms)`);
await new Promise((resolve) => setTimeout(resolve, delay));
console.log(`Built @complex/frontend`);
