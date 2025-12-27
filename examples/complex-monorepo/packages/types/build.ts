const delay = Math.floor(Math.random() * 2000) + 500;
console.log(`Building @complex/types... (simulated ${delay}ms)`);
await new Promise((resolve) => setTimeout(resolve, delay));
console.log(`Built @complex/types`);
