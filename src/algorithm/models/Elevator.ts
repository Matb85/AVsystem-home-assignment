import { Call } from "./Call";
import type { Passenger } from "./Passenger";
import { DEBUG } from "../settings";
import { sleep, Strategies, Dir, CallType } from "../utils";
import { CallPriorityQueue } from "../PriorityQueue";

export class Elevator {
  entryCalls: Call[] = []; // Holds entryCalls
  exitCalls: Call[] = []; // Holds exitCalls
  sequence: CallPriorityQueue = new CallPriorityQueue();

  ID: number;
  currentFloor: number;
  direction: Dir = Dir.UP; // 1- Up, 0 - Down
  idle = true;

  passengerLoadingTime: number; // Always 1 second
  passengerUnloadingTime: number; // Always 1 second
  velocity: number; // Always 1 meter per second
  capacity: number; // The capacity if always 1/4 of the entire building population
  interFloorHeight: number; // Always 3 meters
  N: number;
  L: number;

  private currentPassengers: number[] = [];

  getFloors: () => number[];
  decreaseFloors: (x: number) => void;
  constructor(
    ID: number,
    algorithm: Strategies,
    passengerLoadingTime: number,
    passengerUnloadingTime: number,
    velocity: number,
    capacity: number,
    interFloorHeight: number,
    N: number,
    L: number,
    getFloors: () => number[],
    decreaseFloors: (x: number) => void
  ) {
    this.ID = ID;
    this.N = N;
    this.L = L;
    this.currentFloor = Math.floor(N / 2);
    this.passengerLoadingTime = passengerLoadingTime;
    this.passengerUnloadingTime = passengerUnloadingTime;
    this.velocity = velocity;
    this.capacity = capacity;
    this.interFloorHeight = interFloorHeight;

    this.getFloors = getFloors;
    this.decreaseFloors = decreaseFloors;

    this.startPolling();
    // Start this thread only if user chose Up-peak
    if (algorithm == Strategies.UP_PEAK_THREAD) {
      this.upPeakThread();
    }

    // Start this thread only if user chose Zoning
    if (algorithm == Strategies.ZONING) {
      this.zoningThread();
    }
    this.animateElevator();
  }

  public setCurrentFloor(currentFloor: number): void {
    this.currentFloor = currentFloor;
  }

  /**
   * Generates a exitCall with floor 0 in order to relocate the car to the lobby.
   * The idea is to reduce the waiting time for future passengers arriving at the lobby.
   */
  public async upPeakThread(): Promise<void> {
    while (true) {
      // Check if the elevator is idle
      if (this.idle) {
        // Wait 7 seconds
        await sleep(4000);
        // Check if the elevator is still idle and
        // is not already on the main floor
        if (this.idle && this.currentFloor != 0) {
          // Create the exitCall and add it to the sequence
          const tempCall = new Call(0, 0, 0, "");
          tempCall.setPassage(1);
          tempCall.setSpecialCall(true);

          this.sequence.push(tempCall);
        }
      }

      await sleep(200);
    }
  }

  /**
   * Elevators in idle state are repositioned to the zone’s lowest floor.
   */
  public async zoningThread(): Promise<void> {
    const Z = Math.ceil(this.N / this.L);

    while (true) {
      // Check if the elevator is idle
      //console.log(this.ID, this.sequence.getHeap(), this.idle);
      if (this.idle) {
        // Wait 7 seconds
        await sleep(4000);
        //console.log(this.ID, this.idle, Z, this.currentFloor, this.ID * Z);
        // Check if the elevator is still idle and
        // is not already in it's zone
        if (this.idle && this.currentFloor != this.ID * Z) {
          // Create the exitCall and add it to the sequence
          const tempCall = new Call(0, this.ID * Z, 0, "");
          tempCall.setPassage(1);
          tempCall.setSpecialCall(true);

          this.sequence.push(tempCall);
        }
      }

      await sleep(200);
    }
  }

  /**
   * Responsible for sorting calls assigned by the Group elevatorController
   * into the elevator’s internal sequence list.
   */
  private async startPolling(): Promise<void> {
    while (true) {
      this.performJob();
      await sleep(200);
    }
  }

  /**
   * Checks the sequence queue to find any Calls that need to be removed or added.
   */
  private checkSequence(tempCall: Call): void {
    // Here we are looking for the exitCall of the current entryCall
    if (tempCall.getType() == CallType.ENTRY && tempCall.getFloor() == this.currentFloor) {
      this.decreaseFloors(tempCall.getFloor());

      // Traverse carFloors array to look for a
      // exitCall with the same ID as tempCall
      for (let i = 0; i < this.exitCalls.length; ++i) {
        const tempExitCall = this.exitCalls[i];

        if (tempExitCall.getID() != tempCall.getID()) continue;

        this.setExitCallPassage(tempExitCall);
        this.currentPassengers.push(tempExitCall.getFloor());
        // Add exitCall to sequence
        this.sequence.push(tempExitCall);
        // Remove exitCall from exitCalls array
        this.exitCalls.splice(i, 1);
        break;
      }
    }

    // Check the Calls in the sequence, if the sequence is not empty
    // Here we are looking for all exitCalls and entryCalls that can be removed from sequence
    console.log("---------------------------");
    console.log(this.sequence.getHeap().map(x => (x.getType() == 1 ? "entry" : "exit")));
    console.log(this.sequence.getHeap().map(x => (x.getDirection() == 1 ? "up" : "down")));
    console.log(this.sequence.getHeap().map(x => x.getFloor()));
    console.log(this.sequence.getHeap().map(x => x.getID()));
    if (this.sequence.isEmpty()) return;

    // Traverse the Calls in the sequence to find out if
    // any Calls need to be remove, because their floor matches the currentFloor of the elevator
    let i = 0;
    while (i < this.sequence.size()) {
      const call = this.sequence.getHeap()[i];
      // Remove all exitCalls whose floor is the current floor of the elevator
      // The passengers whose exitCall is the same as currentFloor have already arrived
      if (call.getType() == CallType.EXIT && call.getFloor() == this.currentFloor) {
        this.sequence.remove(call);
        continue;
      }

      // Remove all entryCalls whose floor is the current floor of the elevator,
      // and add exitCalls with the same ID to the sequence
      // The passengers whose entryCall is the same as currentFloor have boarded the elevator
      // and pressed a button inside the elevator (made a exitCall)
      if (call.getType() == CallType.ENTRY && call.getFloor() == this.currentFloor) {
        // Traverse carFloors array
        for (let i = 0; i < this.exitCalls.length; ++i) {
          const tempExitCall = this.exitCalls[i];

          if (tempExitCall.getID() != call.getID()) continue;
          this.setExitCallPassage(tempExitCall);

          this.currentPassengers.push(tempExitCall.getFloor());
          // Add exitCall to sequence
          this.sequence.push(tempExitCall);
          // Remove exitCall from exitCalls array
          this.exitCalls.splice(i, 1);
          break;
        }

        // Remove the entryCall from the sequence
        console.log("decreasing");
        this.decreaseFloors(this.currentFloor);
        this.sequence.remove(call);

        i = 0;
      }
      i += 1;
    }

    console.log("---------------------------");
    console.log(this.currentFloor);
    console.log(this.sequence.getHeap().map(x => (x.getType() == 1 ? "entry" : "exit")));
    console.log(this.sequence.getHeap().map(x => (x.getDirection() == 1 ? "up" : "down")));
    console.log(this.sequence.getHeap().map(x => x.getFloor()));
    console.log(this.sequence.getHeap().map(x => x.getID()));
    console.log("---------------------------");
  }

  /**
   * Assigns passage to calls in the sequence
   */
  private redefinePassage(): void {
    for (const tempCall of this.sequence.getHeap()) {
      if (!tempCall.isSpecialCall()) this.setEntryCallPassage(tempCall);
    }
  }

  /**
   * Animates the current position of the elevator in DOM.
   */
  private animateElevator(): void {
    postMessage({
      ID: this.ID,
      currentFloor: this.currentFloor,
      floors: this.getFloors(),
      currentPassengers: this.currentPassengers.length,
    });
  }

  /**
   * Displays the current position of the elevator in a graphical way.
   */
  private displayElevator(): void {
    console.log(`\n\nElevator ${this.ID}\n`);
    console.log("------------------------------------------\n");
    for (let i = 0; i < this.N; ++i) {
      if (i == this.currentFloor) {
        console.log(" == ");
      } else {
        console.log(i);
      }
    }

    if (this.direction == Dir.UP) {
      console.log("\n\n-->");
    } else {
      console.log("\n\n<--");
    }
    console.log("------------------------------------------\n\n");
  }

  /**
   * Simulates the elevator moving through the shaft
   */
  private async performJob(): Promise<void> {
    if (this.sequence.size() == 0 || !this.idle) return;
    // Get Call from sequence
    const tempCall = this.sequence.pop()!;

    if (DEBUG) {
      console.log("\n\n**************************");
      console.log(`Elevator ${this.ID}, direction: ${this.direction}, current floor: ${this.currentFloor}.\n`);
      console.log(
        `Got a Job | direction: ${tempCall.getDirection()}, passage: ${tempCall.getPassage()}, floor: ${tempCall.getFloor()}, type: ${tempCall.getType()}, ID: ${tempCall.getID()}, upPeakCall: ${tempCall.isSpecialCall()}.\n`
      );
      console.log("**************************\n\n");
    }

    if (tempCall.getFloor() == this.currentFloor) {
      this.checkSequence(tempCall);
      this.idle = true;
      return;
    }

    this.idle = false;
    // Update the direction of the elevator based
    // on the position of the current floor
    // Since the direction has changed, we must
    // reassign passage to all calls in the sequence
    if (tempCall.getFloor() < this.currentFloor) {
      this.direction = Dir.DOWN;
      this.redefinePassage();
    } else if (tempCall.getFloor() > this.currentFloor) {
      this.direction = Dir.UP;
      this.redefinePassage();
    }

    await sleep(this.passengerLoadingTime);

    // Simulate elevator movement through the floors of the building
    while (this.currentFloor != tempCall.getFloor() && this.currentFloor >= 0 && this.currentFloor <= this.N - 1) {
      this.idle = false;

      // Direction is up
      if (this.direction == Dir.UP && this.currentFloor != this.N - 1) {
        this.currentFloor += 1;
      } else if (this.direction == Dir.DOWN && this.currentFloor != 0) {
        this.currentFloor -= 1;
      } else {
        console.log("\n\n\n\n! + ! + ! Elevator is out of range - this.performJob() ! + ! + !\n\n\n\n");
        break;
      }
      await sleep(this.velocity * this.interFloorHeight * 200);

      if (DEBUG) {
        console.log(
          `\n\n+++++ Elevator ${this.ID}, direction: ${this.direction}, current floor: ${this.currentFloor}, target floor: ${tempCall.getFloor()}. +++++\n`
        );
        console.log(
          `+++++ Call direction: ${tempCall.getDirection()}, Call passage: ${tempCall.getPassage()}, Call floor: ${tempCall.getFloor()}, Call type: ${tempCall.getType()}, Call ID: ${tempCall.getID()}. +++++\n\n`
        );
      }

      this.checkSequence(tempCall);
      this.currentPassengers = this.currentPassengers.filter(x => x != this.currentFloor);
      this.animateElevator();
      if (DEBUG) {
        this.displayElevator();
      }
    }

    setTimeout(() => {
      this.idle = true;
    }, this.passengerUnloadingTime);
  }

  /**
   * Breaks apart the Passenger object.
   * Puts Passenger.entryCall to the entryCalls array.
   * Puts Passenger.exitCall to the exitCalls array.
   */
  public receiveJob(pas: Passenger): void {
    const entryCall = pas.getEntryCall(); // Has floor, needs passage
    const exitCall = pas.getExitCall(); // Has floor, needs passage

    this.exitCalls.push(exitCall);

    this.setEntryCallPassage(entryCall);
    this.sequence.push(entryCall);

    if (DEBUG) {
      console.log("--------------------------");
      for (const call of this.sequence.getHeap()) {
        console.log(
          `+++++ Call direction: ${call.getDirection()}, Call passage: ${call.getPassage()}, Call floor: ${call.getFloor()}, Call type: ${call.getType()}, Call ID: ${call.getID()}. +++++\n\n`
        );
      }
      console.log("--------------------------");
      for (const call of this.entryCalls) {
        console.log(
          `+++++ Call direction: ${call.getDirection()}, Call passage: ${call.getPassage()}, Call floor: ${call.getFloor()}, Call type: ${call.getType()}, Call ID: ${call.getID()}. +++++\n\n`
        );
      }
      console.log("--------------------------");
      for (const call of this.exitCalls) {
        console.log(
          `+++++ Call direction: ${call.getDirection()}, Call passage: ${call.getPassage()}, Call floor: ${call.getFloor()}, Call type: ${call.getType()}, Call ID: ${call.getID()}. +++++\n\n`
        );
      }
      console.log("--------------------------");
    }
  }

  private setExitCallPassage(tempExitCall: Call) {
    // Assign passage to exitCall
    // Same direction and higher than currentFloor - P1
    // Opposite direction - P2

    if (this.direction == Dir.UP) {
      if (tempExitCall.getFloor() > this.currentFloor && tempExitCall.getDirection() == this.direction) {
        tempExitCall.setPassage(1);
      } else {
        tempExitCall.setPassage(2);
      }
    } else {
      if (tempExitCall.getFloor() < this.currentFloor && tempExitCall.getDirection() == this.direction) {
        tempExitCall.setPassage(1);
      } else {
        tempExitCall.setPassage(2);
      }
    }
  }
  private setEntryCallPassage(tempCall: Call) {
    // Assign passage to a newly arrived entryCall

    // Same direction and higher than currentFloor - P1
    // Opposite direction - P2
    // Same direction and lower than currentFloor - P3
    if (this.direction == Dir.UP) {
      if (tempCall.getFloor() > this.currentFloor && tempCall.getDirection() == this.direction) {
        tempCall.setPassage(1);
      } else if (tempCall.getFloor() < this.currentFloor && tempCall.getDirection() == this.direction) {
        tempCall.setPassage(3);
      } else {
        tempCall.setPassage(2);
      }
    } else {
      // Same direction and lower than currentFloor - P1
      // Opposite direction - P2
      // Same direction and higher than currentFloor - P3
      if (tempCall.getFloor() < this.currentFloor && tempCall.getDirection() == this.direction) {
        tempCall.setPassage(1);
      } else if (tempCall.getFloor() > this.currentFloor && tempCall.getDirection() == this.direction) {
        tempCall.setPassage(3);
      } else {
        tempCall.setPassage(2);
      }
    }
  }
}