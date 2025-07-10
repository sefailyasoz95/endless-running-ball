import React, { useState, useEffect, useRef, useCallback, JSX } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  PanResponder,
  StyleSheet,
  GestureResponderEvent,
  PanResponderGestureState,
  TextInput,
  Alert,
  Animated,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import Entypo from "@expo/vector-icons/Entypo";
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Audio } from "expo-av";
// Type definitions
interface Position {
	x: number;
	y: number;
}

interface Velocity {
	x: number;
	y: number;
}

interface Box {
	id: number;
	x: number;
	y: number;
	broken: boolean;
	type: "normal" | "milestone"; // milestone boxes give 50 points
	points: number;
}

interface CollectibleBall {
	id: number;
	x: number;
	y: number;
	collected: boolean;
}

interface RedTriangle {
	id: number;
	x: number;
	y: number;
	hit: boolean;
}

type GameState = "nameInput" | "menu" | "playing" | "gameOver";

interface HighScore {
	name: string;
	score: number;
}

interface GameRefs {
	ball: Position;
	velocity: Velocity;
	boxes: Box[];
	collectibleBalls: CollectibleBall[];
	redTriangles: RedTriangle[];
	camera: number;
	score: number;
	gameState: GameState;
	lastMilestone: number;
}

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

const BallRunnerGame: React.FC = () => {
	// State
	const [gameState, setGameState] = useState<GameState>("nameInput");
	const [playerName, setPlayerName] = useState<string>("");
	const [inputName, setInputName] = useState<string>("");
	const [highScore, setHighScore] = useState<HighScore | null>(null);
	const [score, setScore] = useState<number>(0);
	const [ballPosition, setBallPosition] = useState<Position>({
		x: screenWidth / 2,
		y: screenHeight - 500, // Start higher than before
	});
	const [boxes, setBoxes] = useState<Box[]>([]);
	const [collectibleBalls, setCollectibleBalls] = useState<CollectibleBall[]>([]);
	const [redTriangles, setRedTriangles] = useState<RedTriangle[]>([]);
	const [cameraX, setCameraX] = useState<number>(0);

	// Sound refs
	const ballHitSoundRef = useRef<Audio.Sound | null>(null);
	const collectibleSoundRef = useRef<Audio.Sound | null>(null);
	const gameOverSoundRef = useRef<Audio.Sound | null>(null);

	// Refs for game loop
	const gameLoopRef = useRef<number | null>(null);
	const ballRef = useRef<Position>({
		x: screenWidth / 2,
		y: screenHeight - 200, // Start higher than before
	});
	const velocityRef = useRef<Velocity>({ x: 0, y: 0 });
	const boxesRef = useRef<Box[]>([]);
	const collectibleBallsRef = useRef<CollectibleBall[]>([]);
	const redTrianglesRef = useRef<RedTriangle[]>([]);
	const cameraRef = useRef<number>(0);
	const scoreRef = useRef<number>(0);
	const gameStateRef = useRef<GameState>("nameInput");
	const lastMilestoneRef = useRef<number>(0);
	// Rotation animation value
	const rotation = useRef(new Animated.Value(0)).current;

	// Storage keys
	const STORAGE_KEYS = {
		PLAYER_NAME: "@ball_runner_player_name",
		HIGH_SCORE: "@ball_runner_high_score",
	};

	// Load saved data on mount
	useEffect(() => {
		loadSavedData();
	}, []);

	const loadSavedData = async (): Promise<void> => {
		try {
			const savedName = await AsyncStorage.getItem(STORAGE_KEYS.PLAYER_NAME);
			const savedHighScore = await AsyncStorage.getItem(STORAGE_KEYS.HIGH_SCORE);

			if (savedName) {
				setPlayerName(savedName);
				setGameState("menu");
				gameStateRef.current = "menu";
			}

			if (savedHighScore) {
				setHighScore(JSON.parse(savedHighScore));
			}
		} catch (error) {
			console.error("Error loading saved data:", error);
		}
	};

	const savePlayerName = async (name: string): Promise<void> => {
		try {
			await AsyncStorage.setItem(STORAGE_KEYS.PLAYER_NAME, name);
		} catch (error) {
			console.error("Error saving player name:", error);
		}
	};

	const saveHighScore = async (newScore: number): Promise<void> => {
		try {
			const newHighScore: HighScore = { name: playerName, score: newScore };
			await AsyncStorage.setItem(STORAGE_KEYS.HIGH_SCORE, JSON.stringify(newHighScore));
			setHighScore(newHighScore);
		} catch (error) {
			console.error("Error saving high score:", error);
		}
	};

	const handleNameSubmit = (): void => {
		if (inputName.trim().length < 2) {
			Alert.alert("Invalid Name", "Please enter a name with at least 2 characters.");
			return;
		}

		const name = inputName.trim();
		setPlayerName(name);
		savePlayerName(name);
		setGameState("menu");
		gameStateRef.current = "menu";
	};

	const GRAVITY: number = 0.8;
	const JUMP_POWER: number = -15;
	const HORIZONTAL_JUMP: number = 5;
	const BALL_SIZE: number = 30;
	const BOX_SIZE: number = 40;
	const COLLECTIBLE_BALL_SIZE: number = 20;
	const TRIANGLE_SIZE: number = 25;
	const GROUND_LEVEL: number = screenHeight - 100;

	// Rotation animation function
	const rotateBall = () => {
		rotation.setValue(0);
		Animated.timing(rotation, {
			toValue: 1,
			duration: 400,
			useNativeDriver: true,
		}).start();
	};

	// Touch handler
	const handleTouch = useCallback((evt: GestureResponderEvent): void => {
		if (gameStateRef.current !== "playing") return;
		rotateBall(); // Trigger rotation animation
		const touchX: number = evt.nativeEvent.locationX;
		const screenCenter: number = screenWidth / 2;

		// Always jump up
		velocityRef.current.y = JUMP_POWER;

		// Play ball hit sound when jumping
		playBallHitSound();

		// Add horizontal movement based on touch position
		if (touchX > screenCenter + 50) {
			velocityRef.current.x = HORIZONTAL_JUMP;
		} else if (touchX < screenCenter - 50) {
			velocityRef.current.x = -HORIZONTAL_JUMP;
		}
	}, []);

	// Pan responder for touch handling
	const panResponder = PanResponder.create({
		onStartShouldSetPanResponder: (): boolean => true,
		onMoveShouldSetPanResponder: (): boolean => false,
		onPanResponderGrant: (evt: GestureResponderEvent, gestureState: PanResponderGestureState): void => {
			handleTouch(evt);
		},
	});

	const startGame = (): void => {
		setGameState("playing");
		gameStateRef.current = "playing";
		setScore(0);
		scoreRef.current = 0;
		lastMilestoneRef.current = 0;
		setBallPosition({ x: screenWidth / 2, y: screenHeight - 200 });
		setBoxes([]);
		setCollectibleBalls([]);
		setRedTriangles([]);
		setCameraX(0);

		ballRef.current = { x: screenWidth / 2, y: screenHeight - 200 };
		velocityRef.current = { x: 0, y: 0 };
		boxesRef.current = [];
		collectibleBallsRef.current = [];
		redTrianglesRef.current = [];
		cameraRef.current = 0;

		startGameLoop();
	};

	const endGame = (): void => {
		setGameState("gameOver");
		gameStateRef.current = "gameOver";
		if (gameLoopRef.current !== null) {
			cancelAnimationFrame(gameLoopRef.current);
		}

		// Play game over sound
		playGameOverSound();

		// Check if new high score
		if (!highScore || scoreRef.current > highScore.score) {
			saveHighScore(scoreRef.current);
		}
	};

	const generateMilestoneBox = (): void => {
		const newBox: Box = {
			id: Date.now() + Math.random() * 1000,
			x: cameraRef.current + screenWidth + 100,
			y: GROUND_LEVEL - 50, // Very close to ground
			broken: false,
			type: "milestone",
			points: 50,
		};
		boxesRef.current.push(newBox);
	};

	const generateCollectibleBall = (): void => {
		const newBall: CollectibleBall = {
			id: Date.now() + Math.random() * 10000,
			x: cameraRef.current + screenWidth + Math.random() * 200,
			y: GROUND_LEVEL - 150 - Math.random() * 200,
			collected: false,
		};
		collectibleBallsRef.current.push(newBall);
	};

	const generateRedTriangle = (): void => {
		const newTriangle: RedTriangle = {
			id: Date.now() + Math.random() * 20000,
			x: cameraRef.current + screenWidth + Math.random() * 200,
			y: GROUND_LEVEL - 100 - Math.random() * 150,
			hit: false,
		};
		redTrianglesRef.current.push(newTriangle);
	};

	const generateBoxes = (): void => {
		const newBoxes: Box[] = [];
		const startX: number = cameraRef.current + screenWidth;

		for (let i = 0; i < 3; i++) {
			newBoxes.push({
				id: Date.now() + Math.random() * 10000000,
				x: startX + i * 200 + Math.random() * 100,
				y: GROUND_LEVEL - 100 - Math.random() * 200,
				broken: false,
				type: "normal",
				points: 10,
			});
		}

		boxesRef.current = [...boxesRef.current, ...newBoxes];
	};

	const checkMilestones = (): void => {
		const currentMilestone = Math.floor(scoreRef.current / 100) * 100;
		if (currentMilestone > lastMilestoneRef.current && currentMilestone > 0) {
			lastMilestoneRef.current = currentMilestone;
			generateMilestoneBox();
		}
	};

	const checkCollisions = (): void => {
		// Check box collisions
		boxesRef.current.forEach((box: Box, index: number) => {
			if (!box.broken) {
				const ballLeft: number = ballRef.current.x - BALL_SIZE / 2;
				const ballRight: number = ballRef.current.x + BALL_SIZE / 2;
				const ballTop: number = ballRef.current.y - BALL_SIZE / 2;
				const ballBottom: number = ballRef.current.y + BALL_SIZE / 2;

				const boxLeft: number = box.x;
				const boxRight: number = box.x + BOX_SIZE;
				const boxTop: number = box.y;
				const boxBottom: number = box.y + BOX_SIZE;

				if (ballRight > boxLeft && ballLeft < boxRight && ballBottom > boxTop && ballTop < boxBottom) {
					boxesRef.current[index].broken = true;
					scoreRef.current += box.points;
					setScore(scoreRef.current);

					// Play collectible sound when box is broken and points increase
					playCollectibleSound();
				}
			}
		});

		// Check collectible ball collisions
		collectibleBallsRef.current.forEach((ball: CollectibleBall, index: number) => {
			if (!ball.collected) {
				const ballLeft: number = ballRef.current.x - BALL_SIZE / 2;
				const ballRight: number = ballRef.current.x + BALL_SIZE / 2;
				const ballTop: number = ballRef.current.y - BALL_SIZE / 2;
				const ballBottom: number = ballRef.current.y + BALL_SIZE / 2;

				const collectibleLeft: number = ball.x - COLLECTIBLE_BALL_SIZE / 2;
				const collectibleRight: number = ball.x + COLLECTIBLE_BALL_SIZE / 2;
				const collectibleTop: number = ball.y - COLLECTIBLE_BALL_SIZE / 2;
				const collectibleBottom: number = ball.y + COLLECTIBLE_BALL_SIZE / 2;

				if (
					ballRight > collectibleLeft &&
					ballLeft < collectibleRight &&
					ballBottom > collectibleTop &&
					ballTop < collectibleBottom
				) {
					collectibleBallsRef.current[index].collected = true;
					scoreRef.current += 25;
					setScore(scoreRef.current);

					// Play collectible sound when ball is collected
					playCollectibleSound();
				}
			}
		});

		// Check red triangle collisions (game over)
		redTrianglesRef.current.forEach((triangle: RedTriangle, index: number) => {
			if (!triangle.hit) {
				const ballLeft: number = ballRef.current.x - BALL_SIZE / 2;
				const ballRight: number = ballRef.current.x + BALL_SIZE / 2;
				const ballTop: number = ballRef.current.y - BALL_SIZE / 2;
				const ballBottom: number = ballRef.current.y + BALL_SIZE / 2;

				const triangleLeft: number = triangle.x - TRIANGLE_SIZE / 2;
				const triangleRight: number = triangle.x + TRIANGLE_SIZE / 2;
				const triangleTop: number = triangle.y - TRIANGLE_SIZE / 2;
				const triangleBottom: number = triangle.y + TRIANGLE_SIZE / 2;

				if (
					ballRight > triangleLeft &&
					ballLeft < triangleRight &&
					ballBottom > triangleTop &&
					ballTop < triangleBottom
				) {
					endGame();
					return;
				}
			}
		});
	};

	const gameLoop = (): void => {
		if (gameStateRef.current !== "playing") return;

		// Update ball physics
		velocityRef.current.y += GRAVITY;
		ballRef.current.x += velocityRef.current.x;
		ballRef.current.y += velocityRef.current.y;

		// Reduce horizontal velocity (friction)
		velocityRef.current.x *= 0.95;

		// Check ground collision
		if (ballRef.current.y >= GROUND_LEVEL) {
			endGame();
			return;
		}

		// Update camera to follow ball horizontally
		if (ballRef.current.x > cameraRef.current + screenWidth / 2) {
			cameraRef.current = ballRef.current.x - screenWidth / 2;
		}

		// Generate new boxes
		if (boxesRef.current.length < 10) {
			generateBoxes();
		}

		// Generate collectible balls occasionally
		// if (Math.random() < 0.02) {
		// 	generateCollectibleBall();
		// }

		// Generate red triangles after score 500
		if (scoreRef.current >= 500 && Math.random() < 0.015) {
			generateRedTriangle();
		}

		// Remove old items
		boxesRef.current = boxesRef.current.filter((box: Box) => box.x > cameraRef.current - 100);
		collectibleBallsRef.current = collectibleBallsRef.current.filter(
			(ball: CollectibleBall) => ball.x > cameraRef.current - 100
		);
		redTrianglesRef.current = redTrianglesRef.current.filter(
			(triangle: RedTriangle) => triangle.x > cameraRef.current - 100
		);

		// Check for milestone boxes
		checkMilestones();

		// Check collisions
		checkCollisions();

		// Update state
		setBallPosition({ ...ballRef.current });
		setCameraX(cameraRef.current);
		setBoxes([...boxesRef.current]);
		setCollectibleBalls([...collectibleBallsRef.current]);
		setRedTriangles([...redTrianglesRef.current]);

		gameLoopRef.current = requestAnimationFrame(gameLoop);
	};

	const startGameLoop = (): void => {
		generateBoxes();
		gameLoop();
	};

	const resetToMenu = (): void => {
		setGameState("menu");
		gameStateRef.current = "menu";
	};

	// Load sound effects
	const loadSounds = async () => {
		try {
			// Load ball hit sound
			const ballHitSound = new Audio.Sound();
			await ballHitSound.loadAsync(require("./assets/ball-hit-2.mp3"));
			ballHitSoundRef.current = ballHitSound;

			// Load collectible sound
			const collectibleSound = new Audio.Sound();
			await collectibleSound.loadAsync(require("./assets/collectible.mp3"));
			collectibleSoundRef.current = collectibleSound;

			// Load game over sound
			const gameOverSound = new Audio.Sound();
			await gameOverSound.loadAsync(require("./assets/game-over.mp3"));
			gameOverSoundRef.current = gameOverSound;
		} catch (error) {
			console.error("Error loading sounds:", error);
		}
	};

	// Play sound functions
	const playBallHitSound = async () => {
		try {
			if (ballHitSoundRef.current) {
				await ballHitSoundRef.current.setPositionAsync(0);
				await ballHitSoundRef.current.playAsync();
			}
		} catch (error) {
			console.error("Error playing ball hit sound:", error);
		}
	};

	const playCollectibleSound = async () => {
		try {
			if (collectibleSoundRef.current) {
				await collectibleSoundRef.current.setPositionAsync(0);
				await collectibleSoundRef.current.playAsync();
			}
		} catch (error) {
			console.error("Error playing collectible sound:", error);
		}
	};

	const playGameOverSound = async () => {
		try {
			if (gameOverSoundRef.current) {
				await gameOverSoundRef.current.setPositionAsync(0);
				await gameOverSoundRef.current.playAsync();
			}
		} catch (error) {
			console.error("Error playing game over sound:", error);
		}
	};

	useEffect(() => {
		// Load sounds when component mounts
		loadSounds();

		return () => {
			// Unload sounds when component unmounts
			if (gameLoopRef.current !== null) {
				cancelAnimationFrame(gameLoopRef.current);
			}

			if (ballHitSoundRef.current) {
				ballHitSoundRef.current.unloadAsync();
			}
			if (collectibleSoundRef.current) {
				collectibleSoundRef.current.unloadAsync();
			}
			if (gameOverSoundRef.current) {
				gameOverSoundRef.current.unloadAsync();
			}
		};
	}, []);

	// Interpolate rotation value
	const rotateInterpolate = rotation.interpolate({
		inputRange: [0, 1],
		outputRange: ["0deg", "360deg"],
	});

	const renderGame = (): JSX.Element => (
		<View style={styles.gameContainer} {...panResponder.panHandlers}>
			{/* Background Image */}
			<Image 
				source={require('./assets/app-background.png')} 
				style={styles.backgroundImage} 
			/>
			{/* Ground */}
			<View style={styles.ground} />
			{/* Ball */}
			<Animated.View
				style={[
					styles.ball,
					{
						left: ballPosition.x - cameraX - BALL_SIZE / 2,
						top: ballPosition.y - BALL_SIZE / 2,
						transform: [{ rotate: rotateInterpolate }],
					},
				]}>
				<FontAwesome name='soccer-ball-o' size={30} color='black' />
			</Animated.View>

			{/* Boxes */}
			{boxes.map((box: Box) => (
				<View
					key={box.id}
					style={[
						styles.box,
						{
							left: box.x - cameraX,
							top: box.y,
							opacity: box.broken ? 0.5 : 1,
						},
					]}>
					<Entypo
						name='box'
						size={box.type === "milestone" ? 60 : 40}
						color={box.broken ? "rgba(0,0,0,0.5)" : box.type === "milestone" ? "#FF8C00" : "black"}
					/>
				</View>
			))}

			{/* Collectible Balls */}
			{collectibleBalls.map((ball: CollectibleBall) => (
				<View
					key={ball.id}
					style={[
						styles.collectibleBall,
						{
							left: ball.x - cameraX - COLLECTIBLE_BALL_SIZE / 2,
							top: ball.y - COLLECTIBLE_BALL_SIZE / 2,
							opacity: ball.collected ? 0 : 1,
						},
					]}
				/>
			))}

			{/* Red Triangles */}
			{redTriangles.map((triangle: RedTriangle) => (
				<View
					key={triangle.id}
					style={[
						styles.redTriangle,
						{
							left: triangle.x - cameraX - TRIANGLE_SIZE / 2,
							top: triangle.y - TRIANGLE_SIZE / 2,
						},
					]}>
					<FontAwesome5 name='exclamation-triangle' size={24} color='#ff4444' />
				</View>
			))}

			{/* Score */}
			<View style={styles.scoreContainer}>
				<Text style={styles.scoreText}>Score: {score}</Text>
				{highScore && <Text style={styles.highScoreInGame}>High: {highScore.score}</Text>}
			</View>

			{/* Instructions */}
			<View style={styles.instructionsContainer}>
				<Text style={styles.instructionsText}>Tap to jump{"\n"}Tap left/right to move</Text>
			</View>
		</View>
	);

	const renderNameInput = (): JSX.Element => (
		<View style={styles.nameInputContainer}>
			<Text style={styles.titleText}>Ball Runner</Text>
			<Text style={styles.namePrompt}>Enter your name to start playing:</Text>
			<TextInput
				style={styles.nameInput}
				value={inputName}
				onChangeText={setInputName}
				placeholder='Your name'
				placeholderTextColor='#B0C4DE'
				maxLength={20}
				autoCapitalize='words'
				autoCorrect={false}
			/>
			<TouchableOpacity onPress={handleNameSubmit} style={styles.submitButton}>
				<Text style={styles.submitButtonText}>START GAME</Text>
			</TouchableOpacity>

			{/* How to Play */}
			<View style={styles.howToPlayContainer}>
				<Text style={styles.howToPlayTitle}>How to Play:</Text>
				<Text style={styles.howToPlayText}>
					• Tap anywhere on the screen to make the ball jump up
					{"\n"}• Tap on the LEFT side to move the ball left
					{"\n"}• Tap on the RIGHT side to move the ball right
					{"\n"}• Break brown boxes to score 10 points each
					{"\n"}• Break orange milestone boxes (every 100 points) for 50 points
					{"\n"}• Collect green balls for 25 points each
					{"\n"}• Avoid red triangles (appear after 500 points) - they end the game!
					{"\n"}• Don't let the ball touch the ground - Game Over!
					{"\n"}• Keep jumping and scoring to beat your high score!
				</Text>
			</View>
		</View>
	);

	if (gameState === "nameInput") {
		return renderNameInput();
	}

	if (gameState === "menu") {
		return (
			<View style={styles.menuContainer}>
				<Text style={styles.titleText}>Ball Runner</Text>
				<Text style={styles.welcomeText}>Welcome, {playerName}!</Text>

				{highScore && (
					<View style={styles.highScoreContainer}>
						<Text style={styles.highScoreText}>High Score: {highScore.score}</Text>
						<Text style={styles.highScorePlayer}>by {highScore.name}</Text>
					</View>
				)}

				<TouchableOpacity onPress={startGame} style={styles.playButton}>
					<Text style={styles.playButtonText}>PLAY</Text>
				</TouchableOpacity>

				{/* How to Play */}
				<View style={styles.howToPlayContainer}>
					<Text style={styles.howToPlayTitle}>How to Play:</Text>
					<Text style={styles.howToPlayText}>
						• Tap anywhere to jump up • Tap LEFT/RIGHT sides to move
						{"\n"}• Brown boxes = 10 pts • Orange milestone boxes = 50 pts
						{"\n"}• Green balls = 25 pts • Avoid red triangles!
						{"\n"}• Don't touch ground!
					</Text>
				</View>
			</View>
		);
	}

	if (gameState === "gameOver") {
		const isNewHighScore = highScore && score > highScore.score;

		return (
			<View style={styles.gameOverContainer}>
				<Text style={styles.gameOverTitle}>Game Over!</Text>
				<Text style={styles.playerNameText}>{playerName}</Text>

				{isNewHighScore && <Text style={styles.newHighScoreText}>🎉 NEW HIGH SCORE! 🎉</Text>}

				<Text style={styles.finalScore}>Score: {score}</Text>

				{highScore && !isNewHighScore && (
					<Text style={styles.currentHighScore}>
						High Score: {highScore.score} by {highScore.name}
					</Text>
				)}

				<TouchableOpacity onPress={resetToMenu} style={styles.menuButton}>
					<Text style={styles.menuButtonText}>Back to Menu</Text>
				</TouchableOpacity>
				<TouchableOpacity onPress={startGame} style={styles.playAgainButton}>
					<Text style={styles.playAgainButtonText}>Play Again</Text>
				</TouchableOpacity>
			</View>
		);
	}

	return renderGame();
};
export default BallRunnerGame;
const styles = StyleSheet.create({
	nameInputContainer: {
		flex: 1,
		backgroundColor: "#4A90E2",
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 20,
	},

	namePrompt: {
		color: "white",
		fontSize: 18,
		marginBottom: 20,
		textAlign: "center",
	},

	nameInput: {
		backgroundColor: "rgba(255,255,255,0.9)",
		borderRadius: 10,
		paddingHorizontal: 20,
		paddingVertical: 15,
		fontSize: 18,
		color: "#333",
		width: "80%",
		textAlign: "center",
		marginBottom: 20,
	},

	submitButton: {
		backgroundColor: "#FF6B6B",
		paddingHorizontal: 40,
		paddingVertical: 15,
		borderRadius: 25,
		marginBottom: 30,
	},

	submitButtonText: {
		color: "white",
		fontSize: 18,
		fontWeight: "bold",
	},

	howToPlayContainer: {
		backgroundColor: "rgba(0,0,0,0.3)",
		padding: 20,
		borderRadius: 10,
		marginTop: 20,
	},

	howToPlayTitle: {
		color: "white",
		fontSize: 20,
		fontWeight: "bold",
		marginBottom: 10,
		textAlign: "center",
	},

	howToPlayText: {
		color: "white",
		fontSize: 14,
		lineHeight: 22,
		textAlign: "left",
	},

	welcomeText: {
		color: "white",
		fontSize: 20,
		marginBottom: 20,
		textAlign: "center",
	},

	highScoreContainer: {
		backgroundColor: "rgba(255,255,255,0.2)",
		padding: 15,
		borderRadius: 10,
		marginBottom: 30,
		alignItems: "center",
	},

	highScoreText: {
		color: "white",
		fontSize: 18,
		fontWeight: "bold",
	},

	highScorePlayer: {
		color: "white",
		fontSize: 14,
		fontStyle: "italic",
	},

	newHighScoreText: {
		color: "#FFD700",
		fontSize: 20,
		fontWeight: "bold",
		marginBottom: 10,
		textAlign: "center",
	},

	playerNameText: {
		color: "white",
		fontSize: 18,
		marginBottom: 10,
		fontStyle: "italic",
	},

	currentHighScore: {
		color: "white",
		fontSize: 16,
		marginBottom: 20,
		textAlign: "center",
	},

	gameContainer: {
		flex: 1,
		// Background color is now provided by the image
	},

	backgroundImage: {
		position: 'absolute',
		width: '100%',
		height: '100%',
		resizeMode: 'cover',
	},

	ground: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		height: 100,
		backgroundColor: "transparent",
	},

	ball: {
		position: "absolute",
		backgroundColor: "rgba(255,255,255,0.5)",
		borderRadius: 15,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 5,
	},

	box: {
		position: "absolute",
		borderRadius: 5,
	},

	collectibleBall: {
		position: "absolute",
		width: 20,
		height: 20,
		backgroundColor: "#00FF00",
		borderRadius: 10,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 5,
	},

	redTriangle: {
		position: "absolute",
	},

	scoreContainer: {
		position: "absolute",
		top: 50,
		left: 20,
		backgroundColor: "rgba(0,0,0,0.5)",
		padding: 10,
		borderRadius: 10,
	},

	scoreText: {
		color: "white",
		fontSize: 18,
		fontWeight: "bold",
	},

	highScoreInGame: {
		color: "#FFD700",
		fontSize: 14,
		fontWeight: "bold",
		marginTop: 5,
	},

	instructionsContainer: {
		position: "absolute",
		top: 50,
		right: 20,
		backgroundColor: "rgba(0,0,0,0.5)",
		padding: 10,
		borderRadius: 10,
		maxWidth: 150,
	},

	instructionsText: {
		color: "white",
		fontSize: 12,
		textAlign: "center",
	},

	menuContainer: {
		flex: 1,
		backgroundColor: "#4A90E2",
		justifyContent: "center",
		alignItems: "center",
	},

	titleText: {
		fontSize: 32,
		fontWeight: "bold",
		color: "white",
		marginBottom: 50,
		textAlign: "center",
	},

	playButton: {
		backgroundColor: "#FF6B6B",
		paddingHorizontal: 40,
		paddingVertical: 20,
		borderRadius: 25,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 6,
		elevation: 8,
	},

	playButtonText: {
		color: "white",
		fontSize: 24,
		fontWeight: "bold",
	},

	menuInstructions: {
		color: "white",
		fontSize: 14,
		marginTop: 20,
		textAlign: "center",
		paddingHorizontal: 20,
	},

	gameOverContainer: {
		flex: 1,
		backgroundColor: "#E74C3C",
		justifyContent: "center",
		alignItems: "center",
	},
	gameOverTitle: {
		fontSize: 36,
		fontWeight: "bold",
		color: "white",
		marginBottom: 20,
	},
	finalScore: {
		fontSize: 24,
		color: "white",
		marginBottom: 50,
	},
	menuButton: {
		backgroundColor: "#4A90E2",
		paddingHorizontal: 30,
		paddingVertical: 15,
		borderRadius: 20,
		marginBottom: 20,
	},
	menuButtonText: {
		color: "white",
		fontSize: 18,
		fontWeight: "bold",
	},
	playAgainButton: {
		backgroundColor: "#FF6B6B",
		paddingHorizontal: 40,
		paddingVertical: 20,
		borderRadius: 25,
	},
	playAgainButtonText: {
		color: "white",
		fontSize: 24,
		fontWeight: "bold",
	},
});
